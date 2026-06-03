import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import {
  CLOUDFLARE_MODELS,
  resolveAiProvider,
  type AiProviderEnv,
  type ResolvedAiProvider,
} from "@/lib/ai-gateway";

const ChartSpec = z.object({
  chartType: z.enum(["line", "bar", "area", "scatter"]),
  xKey: z.string(),
  yKeys: z.array(z.string()).min(1),
  data: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).min(2),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});
const MathSpec = z.object({
  steps: z.array(z.string()).min(1),
  inline: z.string().optional(),
});
const DiagramSpec = z.object({ mermaid: z.string().min(5) });
const TableSpec = z.object({
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).min(1),
});
const CalloutSpec = z.object({
  body: z.string(),
  tone: z.enum(["info", "warn", "key"]).optional(),
});

// Permissive schema used during model generation — models frequently shortcut
// `diagram: { mermaid: "..." }` to `diagram: "..."`, omit title/narration, or
// emit `null` for unused spec fields. Normalize below before strict validation.
const LooseVisualSchema = z.object({
  title: z.string().optional().nullable(),
  narration: z.string().optional().nullable(),
  kind: z.enum(["chart", "math", "diagram", "table", "callout"]),
  chart: z.any().optional().nullable(),
  math: z.any().optional().nullable(),
  diagram: z.any().optional().nullable(),
  table: z.any().optional().nullable(),
  callout: z.any().optional().nullable(),
});

export const VisualSchema = z.object({
  title: z.string(),
  narration: z.string().describe("One short sentence summarizing what's on screen"),
  kind: z.enum(["chart", "math", "diagram", "table", "callout"]),
  chart: ChartSpec.optional(),
  math: MathSpec.optional(),
  diagram: DiagramSpec.optional(),
  table: TableSpec.optional(),
  callout: CalloutSpec.optional(),
});

export type Visual = z.infer<typeof VisualSchema>;

export function normalizeLoose(
  raw: z.infer<typeof LooseVisualSchema>,
  fallback: { title: string; narration: string },
): { ok: true; visual: Visual } | { ok: false; reason: string } {
  const title = (raw.title ?? "").trim() || fallback.title;
  const narration = (raw.narration ?? "").trim() || fallback.narration;
  const kind = raw.kind;
  const base = { title, narration, kind } as const;

  const coerce = (
    field: "chart" | "math" | "diagram" | "table" | "callout",
  ): unknown => {
    const v = raw[field];
    if (v == null) return undefined;
    if (field === "diagram" && typeof v === "string") return { mermaid: v };
    if (field === "callout" && typeof v === "string") return { body: v };
    if (field === "math" && Array.isArray(v)) return { steps: v as string[] };
    return v;
  };

  // Callouts are pure text and the model frequently omits the `callout` field
  // entirely (putting the body in `narration`, or in misnamed fields like
  // `text` / `message` / `content` / `note` / `body`). Build a guaranteed-valid
  // spec from whatever is present so we never crash on missing structure.
  const coerceCallout = (): { body: string; tone?: "info" | "warn" | "key" } => {
    const direct = coerce("callout");
    if (direct && typeof direct === "object") {
      const o = direct as Record<string, unknown>;
      const body =
        (typeof o.body === "string" && o.body) ||
        (typeof o.text === "string" && o.text) ||
        (typeof o.message === "string" && o.message) ||
        (typeof o.content === "string" && o.content) ||
        (typeof o.note === "string" && o.note) ||
        narration ||
        title;
      const tone =
        o.tone === "info" || o.tone === "warn" || o.tone === "key"
          ? (o.tone as "info" | "warn" | "key")
          : undefined;
      return tone ? { body: String(body), tone } : { body: String(body) };
    }
    // Last resort: synthesize from narration/title so a callout always renders.
    return { body: narration || title };
  };

  try {
    if (kind === "chart") {
      const spec = ChartSpec.parse(coerce("chart"));
      return { ok: true, visual: { ...base, chart: spec } };
    }
    if (kind === "math") {
      const spec = MathSpec.parse(coerce("math"));
      return { ok: true, visual: { ...base, math: spec } };
    }
    if (kind === "diagram") {
      const spec = DiagramSpec.parse(coerce("diagram"));
      return { ok: true, visual: { ...base, diagram: spec } };
    }
    if (kind === "table") {
      const spec = TableSpec.parse(coerce("table"));
      return { ok: true, visual: { ...base, table: spec } };
    }
    const spec = CalloutSpec.parse(coerceCallout());
    return { ok: true, visual: { ...base, callout: spec } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "spec parse failed";
    return { ok: false, reason: `kind="${kind}" spec invalid: ${msg}` };
  }
}


const MERMAID_HEADERS = [
  "graph",
  "flowchart",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "mindmap",
  "timeline",
  "gitGraph",
  "quadrantChart",
];

export function validateMermaid(src: string): { ok: true } | { ok: false; reason: string } {
  const lines = src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("%%"));
  if (lines.length < 2) return { ok: false, reason: "needs a header line plus at least one body line" };
  const first = lines[0];
  if (!MERMAID_HEADERS.some((h) => first === h || first.startsWith(`${h} `) || first.startsWith(`${h}\t`))) {
    return {
      ok: false,
      reason: `first line must start with a mermaid diagram keyword (e.g. ${MERMAID_HEADERS.slice(0, 5).join(", ")}); got "${first}"`,
    };
  }
  // Balance check on common bracket pairs in node labels.
  const pairs: Array<[string, string]> = [
    ["[", "]"],
    ["(", ")"],
    ["{", "}"],
  ];
  for (const [open, close] of pairs) {
    const o = (src.match(new RegExp(`\\${open}`, "g")) ?? []).length;
    const c = (src.match(new RegExp(`\\${close}`, "g")) ?? []).length;
    if (o !== c) return { ok: false, reason: `unbalanced ${open}${close} in mermaid source (${o} vs ${c})` };
  }
  return { ok: true };
}

export function validateVisual(v: Visual): { ok: true } | { ok: false; reason: string } {
  const spec = (v as unknown as Record<string, unknown>)[v.kind];
  if (spec == null) return { ok: false, reason: `kind="${v.kind}" but the matching "${v.kind}" field is missing` };
  if (v.kind === "diagram" && v.diagram) {
    const m = validateMermaid(v.diagram.mermaid);
    if (!m.ok) return { ok: false, reason: `invalid mermaid: ${m.reason}` };
  }
  return { ok: true };
}

const SYSTEM_PROMPT = `You are a scientific visualization generator for a live research-companion slide deck. Each turn you produce ONE slide that makes the user smarter about the paper. Bias hard toward STRUCTURED, INFORMATION-DENSE visuals — never a bare restatement of the topic.

KIND SELECTION (pick the first that fits, UNLESS the topic/hint explicitly requests a specific kind — then you MUST honor it):
1. "diagram" — processes, architectures, pipelines, relationships, taxonomies, contribution maps. Lists of contributions/components/steps render as mermaid mindmap/flowchart, NOT a callout.
2. "table" — comparisons, parameters, ablations, datasets, baselines. Prefer 3-6 columns and 3-8 rows of substantive content.
3. "chart" — quantitative trends/comparisons. Include 8-15 realistic illustrative data points; mark them illustrative in the narration if inferred.
4. "math" — formulas, losses, derivations, complexity, mathematical definitions. Each step is a KaTeX string (no $ delimiters).
5. "callout" — FORBIDDEN unless the user explicitly asked for a quote, definition sentence, or one-line takeaway.

REQUESTED-KIND RULE (CRITICAL):
- Topic/hint mentions "math", "equation", "formula", "formalism", "derivation", "theorem" → MUST return kind="math" with real KaTeX steps.
- Mentions "diagram", "flow", "architecture", "pipeline", "graph", "topology", "tree" → MUST return kind="diagram" with valid mermaid.
- Mentions "chart", "plot", "trend" → MUST return kind="chart".
- Mentions "table", "matrix" → MUST return kind="table".
- NEVER substitute a callout when the user asked for one of the above.

NO-HEDGE RULE (CRITICAL):
- NEVER produce text like "the paper does not provide", "no explicit equations", "not enough information", "the text does not contain", "insufficient detail", or any meta-commentary about the paper's contents.
- If the paper excerpt lacks specifics, fall back to CANONICAL TEXTBOOK KNOWLEDGE of the topic (standard definitions, well-known equations, classical diagrams of the concept) and produce the visual from that. Note "illustrative" in the narration if needed, but DELIVER the visualization.
- Narration MUST describe concrete on-screen content. Never start narration with "Diagram:", "Chart:", "A summary of", "Overview of", or similar meta-labels.

QUALITY BAR:
- Add information beyond restating the title. No slides whose body is just "A summary of X".
- The topic/hint are instructions, not slide content; never render phrases like "A table comparing..." or "summarizing the..." as the visual body.
- Plural topics enumerate the actual items with substance.
- "narration" ≤20 words, references concrete content.
- "title" ≤60 chars, specific.

DIAGRAM SYNTAX:
- First line MUST be one of: "graph TD", "graph LR", "flowchart TD", "flowchart LR", "mindmap", "sequenceDiagram", "classDiagram", "stateDiagram-v2".
- For "list of N things" topics, prefer "mindmap" with the topic as root and each item as a child node.
- Short ASCII node labels; quote multi-word labels inside [ ]. Balance all brackets.

OUTPUT: Populate ONLY the chosen kind's spec field. The "kind" field MUST match the populated spec.`;

export interface IllustrateInput {
  topic: string;
  hint?: string;
  pdfExcerpt?: string;
  /**
   * Titles + kinds of slides already on the canvas, newest first. We surface
   * these to the model so it never repeats a slide back-to-back; one of the
   * regressions we hit was the same RNG-vs-fat-tree table appearing on every
   * slide because nothing in the loop checked prior visuals.
   */
  recentVisuals?: Array<{ title: string; kind: Visual["kind"] }>;
}

export interface IllustrateResult {
  visual: Visual;
  attempts: number;
  warnings: string[];
}

type GenerateTextLike = (args: Record<string, unknown>) => Promise<{
  experimental_output?: unknown;
  text?: string;
}>;

const EXPLICIT_CALLOUT_RE = /\b(quote|direct quote|definition sentence|definition|one[- ]line takeaway|single[- ]sentence takeaway|key takeaway)\b/i;
const GENERIC_VISUAL_HINT_RE = /^(chart|line chart|bar chart|area chart|scatter|math|formula|diagram|table|callout)$/i;
const HEDGE_RE = /\b(does not (provide|contain|include|describe|specify|mention)|not (enough|sufficient) (information|detail|context)|no (explicit|specific) (equations?|formulas?|diagrams?|details?|information)|the (paper|text|excerpt|document) (does not|doesn't|lacks)|insufficient (information|detail|context)|within the provided text|in the provided (text|excerpt))\b/i;
const META_NARRATION_RE = /^\s*(diagram|chart|table|math|formula|equation|illustration|figure|visualization)\s*:/i;
const PROMPT_LIKE_VISUAL_TEXT_RE = /^\s*(a\s+)?(chart|table|diagram|graph|math derivation|callout)\s+(comparing|summarizing|showing|illustrating|describing)\b|\bsummarizing the\b/i;

export function containsHedgeLanguage(text: string | undefined | null): boolean {
  if (!text) return false;
  return HEDGE_RE.test(text) || META_NARRATION_RE.test(text);
}

export function isPromptLikeVisualText(text: string | undefined | null): boolean {
  return Boolean(text && PROMPT_LIKE_VISUAL_TEXT_RE.test(text));
}

const KIND_KEYWORDS: Array<{ kind: Visual["kind"]; re: RegExp }> = [
  { kind: "math", re: /\b(math|mathematic\w*|equation|formula|formalism|derivation|loss function|theorem|proof|complexity bound)\b/i },
  { kind: "table", re: /\b(table|matrix|comparison table)\b/i },
  { kind: "chart", re: /\b(chart|plot|trend|line chart|bar chart|scatter|histogram|curve)\b/i },
  { kind: "diagram", re: /\b(diagram|flowchart|flow chart|architecture|pipeline|topology|mindmap|sequence diagram|state machine|tree structure|expander graph|fat tree)\b/i },
];

export function detectRequestedKind(input: IllustrateInput): Visual["kind"] | null {
  const text = `${input.topic ?? ""} ${input.hint ?? ""}`;
  if (/\bcallout\s*:/i.test(input.hint ?? "") && !isPromptLikeVisualText(input.hint)) return "callout";
  if (EXPLICIT_CALLOUT_RE.test(text)) return "callout";
  for (const { kind, re } of KIND_KEYWORDS) {
    if (re.test(text)) return kind;
  }
  return null;
}

export function createFallbackCalloutVisual(input: IllustrateInput): Visual {
  const hint = input.hint?.replace(/\bcallout\b:?/gi, "").replace(/\s+/g, " ").trim();
  const body = (hint && !GENERIC_VISUAL_HINT_RE.test(hint) ? hint : input.topic || "Key takeaway").slice(0, 320);
  return {
    title: input.topic || "Key takeaway",
    narration: body,
    kind: "callout",
    callout: { body, tone: "key" },
  };
}

function inferFallbackKind(input: IllustrateInput): Visual["kind"] {
  const requested = detectRequestedKind(input);
  if (requested) return requested;
  const text = `${input.topic ?? ""} ${input.hint ?? ""}`;
  if (/\b(compare|comparison|versus|vs\.?|cost|performance|throughput|oversubscription|baseline|trade-?off)\b/i.test(text)) return "table";
  if (/\b(problem|solution|challenge|contribution|innovation|component|summary|summariz\w*|core|architecture|routing|cabling)\b/i.test(text)) return "diagram";
  return "table";
}

function titleFor(input: IllustrateInput, suffix?: string) {
  const base = (input.topic || suffix || "Generated visual").replace(/\s+/g, " ").trim();
  return base.length <= 60 ? base : `${base.slice(0, 57).trim()}…`;
}

function hasRngContext(input: IllustrateInput) {
  return /\bRNG\b|fat\s*tree|Spraypoint|ShuffleBox|expander/i.test(
    `${input.topic ?? ""} ${input.hint ?? ""} ${input.pdfExcerpt ?? ""}`,
  );
}

function createFallbackTableVisual(input: IllustrateInput): Visual {
  const text = `${input.topic ?? ""} ${input.hint ?? ""}`;
  const rng = hasRngContext(input);
  const comparison = /\b(compare|comparison|versus|vs\.?|fat\s*tree|baseline|cost|throughput|performance)\b/i.test(text);
  if (rng && comparison) {
    return {
      title: titleFor(input, "RNG vs Fat Tree"),
      narration: "Rows contrast cost, throughput, routing, and capacity fungibility.",
      kind: "table",
      table: {
        columns: ["Aspect", "RNG / flat expander", "Fat tree baseline"],
        rows: [
          ["Cost", "9–45% lower at equivalent oversubscription", "Higher cost to avoid congestion"],
          ["Throughput", "Matches or exceeds fat trees across traffic patterns", "Can strand capacity across hierarchical cuts"],
          ["Routing", "Spraypoint finds many near edge-disjoint paths", "Shortest paths use a small subset of links"],
          ["Cabling", "ShuffleBox keeps location-pair complexity similar", "Regular hierarchy but less capacity fungibility"],
          ["Failure impact", "Small blast radius in flat topology", "Upper-layer failures affect many endpoints"],
        ],
      },
    };
  }

  return {
    title: titleFor(input, "Problem / solution map"),
    narration: "Rows connect each scaling bottleneck to the proposed mechanism.",
    kind: "table",
    table: {
      columns: ["Bottleneck", "Why it matters", "Mechanism to inspect"],
      rows: rng
        ? [
            ["Capacity fungibility", "Fat-tree cuts strand idle links", "Flat expander cuts expose more bandwidth"],
            ["Routing scale", "k-shortest paths need too much switch memory", "Spraypoint distributes across many paths"],
            ["Cabling complexity", "Random long links are hard to operate", "ShuffleBox shuffles passively at planned sites"],
            ["Predictability", "Parameter search is combinatorial", "Models estimate path length and oversubscription"],
          ]
        : [
            ["Core claim", input.topic || "Topic", "Turn the claim into measurable rows"],
            ["Evidence", input.hint || "Paper-grounded details", "Compare against the baseline"],
            ["Mechanism", "How the method changes behavior", "Show components or equations next"],
          ],
    },
  };
}

function createFallbackDiagramVisual(input: IllustrateInput): Visual {
  const rng = hasRngContext(input);
  const mermaid = rng
    ? `flowchart LR
  P[Fat-tree bottleneck] --> C[Capacity stranded at small cuts]
  C --> E[Flat expander topology]
  E --> S[Spraypoint: many edge-disjoint paths]
  E --> B[ShuffleBox: manageable cabling]
  S --> T[Higher throughput]
  B --> K[Lower cost]`
    : `flowchart LR
  A[Problem] --> B[Mechanism]
  B --> C[Observable effect]
  C --> D[Evidence to compare]
  D --> E[Takeaway]`;
  return {
    title: titleFor(input, "Mechanism diagram"),
    narration: rng
      ? "The flow links stranded capacity to expander routing, cabling, throughput, and cost."
      : "The flow separates problem, mechanism, effect, evidence, and takeaway.",
    kind: "diagram",
    diagram: { mermaid },
  };
}

function createFallbackMathVisual(input: IllustrateInput): Visual {
  const expander = /expander|edge expansion|graph|RNG/i.test(`${input.topic ?? ""} ${input.hint ?? ""}`);
  return {
    title: titleFor(input, expander ? "Edge expansion formalism" : "Canonical formalism"),
    narration: expander
      ? "The equations define expansion as boundary capacity over subset size."
      : "The equations provide a canonical symbolic frame for the requested concept.",
    kind: "math",
    math: {
      inline: expander ? "For a graph G=(V,E), every small node set should have a large outgoing cut." : undefined,
      steps: expander
        ? [
            "G=(V,E),\\quad S\\subset V,\\quad 0<|S|\\le |V|/2",
            "\\partial S = \\{(u,v)\\in E: u\\in S,\\ v\\notin S\\}",
            "h(G)=\\min_{0<|S|\\le |V|/2}\\frac{|\\partial S|}{|S|}",
            "\\text{large }h(G)\\Rightarrow\\text{large cut bandwidth and capacity fungibility}",
          ]
        : [
            "\\text{objective}=\\text{signal}-\\text{cost}",
            "\\Delta=\\text{method outcome}-\\text{baseline outcome}",
            "\\text{gain}=\\frac{\\Delta}{\\text{baseline outcome}}",
          ],
    },
  };
}

function createFallbackChartVisual(input: IllustrateInput): Visual {
  return {
    title: titleFor(input, "Illustrative performance comparison"),
    narration: "Illustrative bars encode the paper’s reported cost and throughput direction.",
    kind: "chart",
    chart: {
      chartType: "bar",
      xKey: "metric",
      yKeys: ["RNG", "Fat tree"],
      xLabel: "Metric",
      yLabel: "Relative index",
      data: [
        { metric: "Cost efficiency", RNG: 145, "Fat tree": 100 },
        { metric: "Throughput", RNG: 115, "Fat tree": 100 },
        { metric: "Capacity use", RNG: 125, "Fat tree": 100 },
      ],
    },
  };
}

export function createFallbackVisual(input: IllustrateInput, forcedKind?: Visual["kind"]): Visual {
  const kind = forcedKind ?? inferFallbackKind(input);
  if (kind === "callout") return createFallbackCalloutVisual(input);
  if (kind === "math") return createFallbackMathVisual(input);
  if (kind === "diagram") return createFallbackDiagramVisual(input);
  if (kind === "chart") return createFallbackChartVisual(input);
  return createFallbackTableVisual(input);
}

export function isBillingOrCreditError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b402\b|payment required|billing|credits? exhausted|insufficient credits|add credits/i.test(msg);
}

function shouldRenderLocalCallout(input: IllustrateInput) {
  return detectRequestedKind(input) === "callout";
}

export async function generateVisual(
  input: IllustrateInput,
  opts: {
    apiKey?: string;
    env?: AiProviderEnv;
    resolvedProvider?: ResolvedAiProvider;
    maxAttempts?: number;
    generateTextImpl?: GenerateTextLike;
  } = {},
): Promise<IllustrateResult> {
  if (shouldRenderLocalCallout(input)) {
    return { visual: createFallbackCalloutVisual(input), attempts: 0, warnings: [] };
  }

  let resolved: ResolvedAiProvider;
  try {
    resolved =
      opts.resolvedProvider ??
      resolveAiProvider(
        opts.env ?? {
          cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
          cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
          lovableApiKey: opts.apiKey || process.env.LOVABLE_API_KEY,
        },
      );
  } catch (err) {
    // Surface the real reason — silently rendering a stub was hiding outages.
    throw err instanceof Error ? err : new Error(String(err));
  }

  const maxAttempts = opts.maxAttempts ?? 4;
  const runGenerateText = (opts.generateTextImpl ?? generateText) as GenerateTextLike;

  const models =
    resolved.source === "cloudflare"
      ? [CLOUDFLARE_MODELS.primary, CLOUDFLARE_MODELS.secondary, CLOUDFLARE_MODELS.tertiary]
      : ["google/gemini-3-flash-preview", "google/gemini-2.5-flash", "google/gemini-2.5-pro"];

  const warnings: string[] = [];
  let lastError = "";

  const recent = (input.recentVisuals ?? []).slice(0, 6);
  const recentBlock = recent.length
    ? `\nSlides already on the canvas (newest first) — DO NOT repeat any of these titles, and pick a DIFFERENT "kind" than the most recent one unless the user explicitly asked for the same kind:\n${recent
        .map((r, i) => `${i + 1}. ${r.kind}: ${r.title}`)
        .join("\n")}\n`
    : "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const modelId = models[Math.min(attempt - 1, models.length - 1)];
    const model = resolved.provider(modelId);
    const correction = lastError
      ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError}\nReturn a corrected, complete JSON object that matches the schema exactly.`
      : "";
    const prompt = `Topic: ${input.topic}
${input.hint ? `Hint: ${input.hint}\n` : ""}${input.pdfExcerpt ? `Paper context (excerpt):\n${input.pdfExcerpt.slice(0, 8000)}\n` : ""}${recentBlock}${correction}`;

    try {
      const { experimental_output: rawOut, text } = await runGenerateText({
        model,
        experimental_output: Output.object({ schema: LooseVisualSchema }),
        system: SYSTEM_PROMPT,
        prompt,
      });
      let loose: z.infer<typeof LooseVisualSchema> | undefined;
      const generated = LooseVisualSchema.safeParse(rawOut);
      if (generated.success) loose = generated.data;
      if (!loose && text) {
        // generateText didn't parse — try to recover from raw text.
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = LooseVisualSchema.safeParse(JSON.parse(match[0]));
          if (parsed.success) loose = parsed.data;
        }
      }
      if (!loose) {
        lastError = "model returned no parseable JSON object";
        warnings.push(`attempt ${attempt} (${modelId}): ${lastError}`);
        continue;
      }
      const normalized = normalizeLoose(loose, {
        title: input.topic,
        narration: input.hint ?? `Visualization of ${input.topic}`,
      });
      if (!normalized.ok) {
        lastError = normalized.reason;
        warnings.push(`attempt ${attempt} (${modelId}): ${normalized.reason}`);
        continue;
      }
      const check = validateVisual(normalized.visual);
      if (!check.ok) {
        lastError = check.reason;
        warnings.push(`attempt ${attempt} (${modelId}): ${check.reason}`);
        continue;
      }
      const requestedKind = detectRequestedKind(input);
      if (requestedKind && requestedKind !== "callout" && normalized.visual.kind !== requestedKind) {
        lastError = `requested kind="${requestedKind}" but model returned kind="${normalized.visual.kind}". Re-generate as ${requestedKind} using canonical textbook knowledge if the paper lacks specifics.`;
        warnings.push(`attempt ${attempt} (${modelId}): ${lastError}`);
        continue;
      }
      const hedgeSource = [
        normalized.visual.narration,
        normalized.visual.callout?.body,
      ].find((t) => containsHedgeLanguage(t));
      if (hedgeSource) {
        lastError = `output contained hedge/meta language ("${hedgeSource.slice(0, 120)}"). Re-generate with concrete content using canonical textbook knowledge if the paper lacks specifics. No meta-commentary about the paper's contents.`;
        warnings.push(`attempt ${attempt} (${modelId}): hedge language detected`);
        continue;
      }
      const promptLikeSource = [
        normalized.visual.narration,
        normalized.visual.callout?.body,
      ].find((t) => isPromptLikeVisualText(t));
      if (promptLikeSource) {
        lastError = `output repeated the visualization prompt instead of rendering content ("${promptLikeSource.slice(0, 120)}"). Return concrete rows, equations, chart points, or mermaid nodes.`;
        warnings.push(`attempt ${attempt} (${modelId}): prompt-like visual text detected`);
        continue;
      }
      return { visual: normalized.visual, attempts: attempt, warnings };
    } catch (err) {
      const msg =
        err instanceof NoObjectGeneratedError
          ? `model returned non-conforming JSON (${err.message}). Raw text: ${(err.text ?? "").slice(0, 400)}`
          : err instanceof Error
            ? err.message
            : "unknown generation error";
      if (isBillingOrCreditError(err)) {
        const fallback = createFallbackVisual(input);
        return {
          visual: fallback,
          attempts: attempt,
          warnings: [
            ...warnings,
            `attempt ${attempt} (${modelId}): AI visual generation unavailable; rendered a local ${fallback.kind}.`,
          ],
        };
      }
      lastError = msg;
      warnings.push(`attempt ${attempt} (${modelId}): ${msg}`);
    }
  }

  const fallback = createFallbackVisual(input);
  return {
    visual: fallback,
    attempts: maxAttempts,
    warnings: [
      ...warnings,
      `AI visual generation did not return a valid spec; rendered a local ${fallback.kind}.${lastError ? ` Last error: ${lastError}` : ""}`,
    ],
  };
}
