import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import {
  GROQ_BASE_URL,
  GROQ_MODELS,
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
  mermaid: z.any().optional().nullable(),
  columns: z.any().optional().nullable(),
  rows: z.any().optional().nullable(),
  chartType: z.any().optional().nullable(),
  xKey: z.any().optional().nullable(),
  yKeys: z.any().optional().nullable(),
  data: z.any().optional().nullable(),
  xLabel: z.any().optional().nullable(),
  yLabel: z.any().optional().nullable(),
  steps: z.any().optional().nullable(),
  inline: z.any().optional().nullable(),
  body: z.any().optional().nullable(),
  tone: z.any().optional().nullable(),
  text: z.any().optional().nullable(),
  message: z.any().optional().nullable(),
  content: z.any().optional().nullable(),
  note: z.any().optional().nullable(),
}).passthrough();

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
    const record = raw as Record<string, unknown>;
    const nestedCandidates = [record.spec, record.visual, record.diagramSpec, record.payload]
      .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v)));
    const firstString = (keys: string[]) => {
      for (const key of keys) {
        if (typeof record[key] === "string") return record[key];
        for (const nested of nestedCandidates) {
          if (typeof nested[key] === "string") return nested[key];
        }
      }
      for (const value of Object.values(record)) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
          const obj = value as Record<string, unknown>;
          for (const key of keys) if (typeof obj[key] === "string") return obj[key];
        }
      }
      return undefined;
    };
    const v = raw[field];
    if (v == null) {
      if (field === "diagram") {
        if (typeof record.spec === "string") return { mermaid: record.spec };
        const mermaid = firstString(["mermaid", "mermaidDiagram", "mermaid_code", "diagramCode", "source", "code"]);
        if (mermaid) return { mermaid };
      }
      if (field === "table") {
        if (raw.columns && raw.rows) return { columns: raw.columns, rows: raw.rows };
        // Model often nests table under spec/payload/visual/data, or returns
        // { table: { columns, rows } } via a sibling object. Search for the
        // first nested object that has both columns and rows arrays.
        for (const nested of nestedCandidates) {
          if (Array.isArray(nested.columns) && Array.isArray(nested.rows)) {
            return { columns: nested.columns, rows: nested.rows };
          }
          if (nested.table && typeof nested.table === "object") return nested.table;
        }
        for (const value of Object.values(record)) {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            const obj = value as Record<string, unknown>;
            if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
              return { columns: obj.columns, rows: obj.rows };
            }
          }
        }
      }
      if (field === "chart" && raw.chartType && raw.xKey && raw.yKeys && raw.data) {
        return {
          chartType: raw.chartType,
          xKey: raw.xKey,
          yKeys: raw.yKeys,
          data: raw.data,
          xLabel: raw.xLabel ?? undefined,
          yLabel: raw.yLabel ?? undefined,
        };
      }
      if (field === "math" && raw.steps) return { steps: raw.steps, inline: raw.inline ?? undefined };
      if (field === "callout") {
        const body = raw.body ?? raw.text ?? raw.message ?? raw.content ?? raw.note;
        if (typeof body === "string") return { body, tone: raw.tone ?? undefined };
      }
      return undefined;
    }
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
      const parsed = DiagramSpec.parse(coerce("diagram"));
      const spec = { mermaid: sanitizeMermaid(parsed.mermaid) };
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

function sanitizeMermaid(src: string) {
  let out = src
    .replace(/\[([^\]\n]*?):\s*([^\]\n]*?)\]/g, "[$1 - $2]")
    .replace(/\(\(([^)\n]*?):\s*([^)]*?)\)\)/g, "(($1 - $2))");
  // Mindmaps cannot contain flowchart arrows; convert "a --> b" to a parent/child
  // pair so we at least produce parseable output instead of a lexer error.
  const firstLine = out.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (/^mindmap\b/.test(firstLine)) {
    out = out
      .split("\n")
      .map((line) => {
        const m = line.match(/^(\s*)(.+?)\s*-->\s*(.+?)\s*$/);
        if (!m) return line;
        const [, indent, parent, child] = m;
        const cleanParent = parent.replace(/^\[|\]$/g, "").trim();
        const cleanChild = child.replace(/^\[|\]$/g, "").trim();
        return `${indent}${cleanParent}\n${indent}  ${cleanChild}`;
      })
      .join("\n");
  }
  return out;
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

const MERMAID_DIAGRAM_GUIDE = `MERMAID DIAGRAM SKILL — invalid mermaid is the #1 failure mode. Read every rule. Self-check before emitting.

================================================================
A. GLOBAL RULES (apply to ALL diagram types)
================================================================
A1. Line 1 must be EXACTLY one diagram header keyword and nothing else (optionally followed by direction for flowchart). No prose, no markdown fence, no "diagram:" prefix.
A2. NEVER mix syntaxes from different diagram types in one source. A "mindmap" file uses mindmap syntax only; a "flowchart" file uses flowchart syntax only; etc.
A3. Balance every bracket pair: every [ has a ], every ( has a ), every { has a }, every (( has a )), every {{ has a }}.
A4. NEVER put ':' inside a node label. Use ' - ' or ' — ' instead. (Colons are syntactically reserved in many diagram types.)
A5. NEVER put commas, parentheses, or quotes inside an unquoted label. If you need them, wrap the WHOLE label in double quotes: A["Throughput (Gbps), measured"].
A6. Node IDs are short ASCII identifiers ([A-Za-z][A-Za-z0-9_]*). Labels go inside the shape brackets, not inline as bare text.
A7. One statement per line. Do NOT chain multiple edges on one line separated by spaces (e.g. "A --> B  B --> C" is INVALID — put each on its own line).
A8. Emit at least 4 substantive nodes/items; never a 2-node toy diagram.
A9. No emojis, no HTML tags, no markdown inside labels.

================================================================
B. flowchart  (use for: processes, architectures, pipelines, decision flows)
================================================================
Header: "flowchart TD" (top-down) or "flowchart LR" (left-right).

Edge syntax:
  A --> B                  // plain edge
  A -- "label" --> B        // labeled edge (quote multi-word labels)
  A -.-> B                  // dotted edge
  A ==> B                   // thick edge

Node shapes (declare label once, then reference by ID):
  A[Rectangle]
  B(Rounded)
  C((Circle))
  D{Diamond}
  E[/Parallelogram/]
  F[(Cylinder)]

CORRECT EXAMPLE — COPY THIS SHAPE:
  flowchart LR
    Q[User query] --> R{Cache hit?}
    R -- yes --> C[Return cached]
    R -- no --> M[Run model]
    M --> S[(Store result)]
    S --> C

WRONG examples to avoid:
  [WP0] --> [WP1]                       // bare brackets, no node IDs
  A --> B  B --> C                      // two edges on one line
  A[Step: detail] --> B                 // colon inside label
  flowchart LR\\n  A((R1)) A -- B  A -- C  // chained edges, no -->

================================================================
C. mindmap  (use for: hierarchies, "list of N things", taxonomies, contribution maps)
================================================================
Header: "mindmap" (no direction).

Rules:
  - Hierarchy is INDENTATION ONLY (2 spaces per level). NEVER use --> arrows.
  - Root on its own line; can use shape: root((Title)) or root[Title] or plain text.
  - Children are plain text, indented under their parent. No [labels] required.
  - Do NOT chain children on one line.

CORRECT EXAMPLE — COPY THIS SHAPE:
  mindmap
    root((Paper title))
      Contribution 1
        Detail A
        Detail B
      Contribution 2
        Detail C
      Contribution 3
        Detail D
        Detail E

WRONG examples to avoid:
  mindmap\\n  root((R)) A --> B          // arrows are forbidden in mindmap
  mindmap\\n  root((R5))  A -- B  A -- C // chained siblings + edge syntax (this is the exact bug we keep hitting)
  mindmap\\n  root\\n    [Child: thing]  // colon inside label

================================================================
D. sequenceDiagram  (use for: actor-to-actor message timelines)
================================================================
Header: "sequenceDiagram"

  sequenceDiagram
    participant U as User
    participant S as Server
    U->>S: request payload
    S-->>U: response payload
    Note over U,S: Optional annotation

Arrows: ->> (solid), -->> (dashed), -x (with cross).

================================================================
E. classDiagram
================================================================
  classDiagram
    class Node {
      +id: string
      +children: Node[]
      +visit() void
    }
    Node "1" --> "*" Node : children

================================================================
F. stateDiagram-v2
================================================================
  stateDiagram-v2
    [*] --> Idle
    Idle --> Running : start
    Running --> Idle : stop
    Running --> [*] : crash

================================================================
G. SELF-CHECK (run mentally before returning the mermaid string)
================================================================
1. Is line 1 exactly one valid header keyword?
2. If header is "mindmap": are there ZERO occurrences of "-->" or "--" edges?
3. Does every "[" have a matching "]"? Every "("? Every "{"?
4. Is every ":" outside of bracketed labels (only allowed in sequenceDiagram messages, classDiagram relations, and stateDiagram transitions)?
5. Is every edge / child on its own line?
6. Are there at least 4 substantive nodes?
If any answer is no, FIX IT before emitting.`;

const SYSTEM_PROMPT = `You are a scientific visualization generator for a live research-companion slide deck. Each turn you produce ONE slide that makes the user smarter about the paper. Bias hard toward STRUCTURED, INFORMATION-DENSE visuals — never a bare restatement of the topic.

KIND SELECTION (pick the first that fits, UNLESS the topic/hint explicitly requests a specific kind — then you MUST honor it):
1. "diagram" — processes, architectures, pipelines, relationships, taxonomies, contribution maps. Lists of contributions/components/steps render as mermaid mindmap/flowchart, NOT a callout.
2. "table" — comparisons, parameters, ablations, datasets, baselines. Prefer 3-6 columns and 3-8 rows of substantive content.
3. "chart" — quantitative trends/comparisons. Include 8-15 realistic illustrative data points; mark them illustrative in the narration if inferred.
4. "math" — formulas, losses, derivations, complexity, mathematical definitions. Each step is a KaTeX string (no $ delimiters).
5. "callout" — FORBIDDEN. Never return kind="callout". Slides must always contain a real visual asset (diagram, chart, table, or equations). If the topic only suggests a quote or one-line takeaway, promote it to a diagram (mindmap or flowchart) or table that decomposes the idea into concrete parts.

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

${MERMAID_DIAGRAM_GUIDE}

OUTPUT: Return a single JSON object. Populate ONLY the chosen kind's spec field. The "kind" field MUST match the populated spec. Respond with valid JSON only, no prose.`;

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
  // Callouts are intentionally NOT detectable — we never produce text-only
  // slides, even when the user/agent asks for a quote or "key takeaway".
  // Such requests get promoted to a real visual by the model or the fallback.
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
  let kind = forcedKind ?? inferFallbackKind(input);
  // Never produce text-only slides — promote callouts to a real visual.
  if (kind === "callout") kind = "diagram";
  if (kind === "math") return createFallbackMathVisual(input);
  if (kind === "diagram") return createFallbackDiagramVisual(input);
  if (kind === "chart") return createFallbackChartVisual(input);
  return createFallbackTableVisual(input);
}

export function isBillingOrCreditError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b402\b|payment required|billing|credits? exhausted|insufficient credits|add credits/i.test(msg);
}

// ---------------------------------------------------------------------------
// Groq strict structured outputs path
//
// Groq's openai/gpt-oss-20b model supports response_format=json_schema with
// strict: true, which uses constrained decoding to GUARANTEE schema-valid JSON.
// We pre-select the visual kind from the request so the schema is a single
// concrete object (strict mode forbids optional fields / additionalProperties),
// and we stop burning retries on malformed JSON.
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type StrictKind = "diagram" | "table" | "math" | "chart";

// JSON Schemas built for strict mode (all fields required, additionalProperties: false).
const STRICT_KIND_SCHEMAS: Record<StrictKind, Record<string, unknown>> = {
  diagram: {
    type: "object",
    properties: {
      title: { type: "string", description: "≤60 char specific title" },
      narration: { type: "string", description: "One short sentence describing on-screen content" },
      mermaid: {
        type: "string",
        description:
          "Valid mermaid source. Line 1 is exactly one header: 'flowchart TD', 'flowchart LR', 'mindmap', 'sequenceDiagram', 'classDiagram', or 'stateDiagram-v2'. Do NOT mix syntaxes — mindmaps use indentation only and MUST NOT contain '-->' arrows or '[Label]' children. Flowcharts use 'A[Label] --> B[Label]' with short ASCII ids. Balance every [ ] ( ) { }. No ':' inside node labels.",
      },
    },
    required: ["title", "narration", "mermaid"],
    additionalProperties: false,
  },
  table: {
    type: "object",
    properties: {
      title: { type: "string" },
      narration: { type: "string" },
      columns: {
        type: "array",
        items: { type: "string" },
        description: "3-6 column headers",
      },
      rows: {
        type: "array",
        description: "3-8 rows; each row must have exactly the same length as columns",
        items: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    required: ["title", "narration", "columns", "rows"],
    additionalProperties: false,
  },
  math: {
    type: "object",
    properties: {
      title: { type: "string" },
      narration: { type: "string" },
      inline: { type: "string", description: "Optional one-line plain English summary; empty string is OK" },
      steps: {
        type: "array",
        items: { type: "string" },
        description: "Each step is a KaTeX string with NO $ delimiters",
      },
    },
    required: ["title", "narration", "inline", "steps"],
    additionalProperties: false,
  },
  chart: {
    type: "object",
    properties: {
      title: { type: "string" },
      narration: { type: "string" },
      chartType: { type: "string", enum: ["line", "bar", "area", "scatter"] },
      xLabel: { type: "string" },
      yLabel: { type: "string" },
      series: {
        type: "array",
        description: "One entry per data series",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            points: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  x: { type: "string", description: "X-axis label or value as string" },
                  y: { type: "number" },
                },
                required: ["x", "y"],
                additionalProperties: false,
              },
            },
          },
          required: ["name", "points"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "narration", "chartType", "xLabel", "yLabel", "series"],
    additionalProperties: false,
  },
};

interface StrictChartPayload {
  title: string;
  narration: string;
  chartType: "line" | "bar" | "area" | "scatter";
  xLabel: string;
  yLabel: string;
  series: Array<{ name: string; points: Array<{ x: string; y: number }> }>;
}

function strictPayloadToVisual(kind: StrictKind, payload: unknown): Visual {
  const p = payload as Record<string, unknown>;
  const title = String(p.title ?? "").slice(0, 80);
  const narration = String(p.narration ?? "");
  if (kind === "diagram") {
    return {
      title,
      narration,
      kind: "diagram",
      diagram: { mermaid: sanitizeMermaid(String(p.mermaid ?? "")) },
    };
  }
  if (kind === "table") {
    return {
      title,
      narration,
      kind: "table",
      table: {
        columns: (p.columns as string[]) ?? [],
        rows: (p.rows as string[][]) ?? [],
      },
    };
  }
  if (kind === "math") {
    const inline = typeof p.inline === "string" && p.inline.trim() ? p.inline : undefined;
    return {
      title,
      narration,
      kind: "math",
      math: {
        steps: (p.steps as string[]) ?? [],
        ...(inline ? { inline } : {}),
      },
    };
  }
  // chart — fold {series:[{name,points:[{x,y}]}]} back into {xKey,yKeys,data[]}
  const chart = payload as StrictChartPayload;
  const xKey = "x";
  const yKeys = chart.series.map((s) => s.name);
  // Merge points by x value across series.
  const merged = new Map<string, Record<string, number | string>>();
  for (const s of chart.series) {
    for (const pt of s.points) {
      const row = merged.get(pt.x) ?? { x: pt.x };
      row[s.name] = pt.y;
      merged.set(pt.x, row);
    }
  }
  return {
    title,
    narration,
    kind: "chart",
    chart: {
      chartType: chart.chartType,
      xKey,
      yKeys,
      xLabel: chart.xLabel || undefined,
      yLabel: chart.yLabel || undefined,
      data: Array.from(merged.values()),
    },
  };
}

const STRICT_SYSTEM_PROMPT = `You are a scientific visualization generator for a live research-companion slide deck. Each turn you produce ONE slide that makes the user smarter about the paper. Bias hard toward STRUCTURED, INFORMATION-DENSE visuals — never a bare restatement of the topic.

The "kind" of slide has been pre-selected by the caller; fill the schema for that kind with concrete, substantive content.

NO-HEDGE RULE (CRITICAL):
- NEVER write text like "the paper does not provide", "no explicit equations", "not enough information", "the text does not contain", "insufficient detail", or any meta-commentary about the paper's contents.
- If the paper excerpt lacks specifics, fall back to CANONICAL TEXTBOOK KNOWLEDGE of the topic (standard definitions, well-known equations, classical diagrams) and produce the visual from that. Note "illustrative" in the narration if needed, but DELIVER the visualization.
- Narration MUST describe concrete on-screen content. Never start narration with "Diagram:", "Chart:", "A summary of", "Overview of", or similar meta-labels.

QUALITY BAR:
- Add information beyond restating the title.
- Plural topics enumerate the actual items with substance.
- "narration" ≤20 words, references concrete content.
- "title" ≤60 chars, specific.

${MERMAID_DIAGRAM_GUIDE}

TABLE SHAPE (when kind=table): 3-6 columns, 3-8 rows of substantive content. Every row MUST have exactly the same number of cells as the columns array.

MATH SHAPE (when kind=math): each step is a KaTeX string (no $ delimiters). Use \\frac, \\sum, etc.

CHART SHAPE (when kind=chart): 8-15 realistic illustrative points per series.`;

/** Pick the concrete kind to ask the strict-output model for. Never callout. */
export function pickStrictKind(input: IllustrateInput): StrictKind {
  const requested = detectRequestedKind(input);
  if (requested && requested !== "callout") return requested;
  const inferred = inferFallbackKind(input);
  return inferred === "callout" ? "diagram" : (inferred as StrictKind);
}

/** Call Groq's strict structured-output endpoint. Returns a validated Visual. */
export async function generateVisualGroqStrict(
  input: IllustrateInput,
  opts: {
    apiKey: string;
    kind?: StrictKind;
    model?: string;
    fetchImpl?: FetchLike;
    recentBlock?: string;
  },
): Promise<Visual> {
  const kind = opts.kind ?? pickStrictKind(input);
  const schema = STRICT_KIND_SCHEMAS[kind];
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch.bind(globalThis) as FetchLike);
  const model = opts.model ?? GROQ_MODELS.structured;

  const userPrompt = `Topic: ${input.topic}
${input.hint ? `Hint: ${input.hint}\n` : ""}${input.pdfExcerpt ? `Paper context (excerpt):\n${input.pdfExcerpt.slice(0, 8000)}\n` : ""}${opts.recentBlock ?? ""}
Kind pre-selected by caller: ${kind}.
Produce the JSON object for this kind with concrete, information-dense content.`;

  const body = {
    model,
    messages: [
      { role: "system", content: STRICT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: `visual_${kind}`,
        strict: true,
        schema,
      },
    },
    temperature: 0.5,
  };

  const res = await fetchImpl(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq strict call failed: ${res.status} ${res.statusText} ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error("Groq strict call returned empty content");
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Groq strict call returned non-JSON content despite strict mode: ${(err as Error).message}. Content head: ${content.slice(0, 200)}`,
    );
  }
  const visual = strictPayloadToVisual(kind, payload);
  const check = validateVisual(visual);
  if (!check.ok) {
    throw new Error(`Strict visual failed downstream validation: ${check.reason}`);
  }
  return visual;
}


export async function generateVisual(
  input: IllustrateInput,
  opts: {
    apiKey?: string;
    env?: AiProviderEnv;
    resolvedProvider?: ResolvedAiProvider;
    maxAttempts?: number;
    generateTextImpl?: GenerateTextLike;
    fetchImpl?: FetchLike;
  } = {},
): Promise<IllustrateResult> {

  const env = opts.env ?? {
    groqApiKey: process.env.GROQ_API_KEY,
    lovableApiKey: opts.apiKey || process.env.LOVABLE_API_KEY,
  };
  let resolved: ResolvedAiProvider;
  try {
    resolved = opts.resolvedProvider ?? resolveAiProvider(env);
  } catch (err) {
    // Surface the real reason — silently rendering a stub was hiding outages.
    throw err instanceof Error ? err : new Error(String(err));
  }

  const maxAttempts = opts.maxAttempts ?? 4;
  const runGenerateText = (opts.generateTextImpl ?? generateText) as GenerateTextLike;

  const models =
    resolved.source === "groq"
      ? [GROQ_MODELS.fast]
      : ["google/gemini-3-flash-preview", "google/gemini-2.5-flash", "google/gemini-2.5-pro"];

  const warnings: string[] = [];
  let lastError = "";

  const recent = (input.recentVisuals ?? []).slice(0, 6);
  const recentBlock = recent.length
    ? `\nSlides already on the canvas (newest first) — DO NOT repeat any of these titles, and pick a DIFFERENT "kind" than the most recent one unless the user explicitly asked for the same kind:\n${recent
        .map((r, i) => `${i + 1}. ${r.kind}: ${r.title}`)
        .join("\n")}\n`
    : "";

  // FAST PATH: Groq strict structured outputs. Constrained decoding guarantees
  // schema-valid JSON. If the result is semantically invalid (hedge language,
  // prompt-like narration, malformed Mermaid), surface the error to the caller
  // instead of substituting a deterministic visual.
  // Skipped if the caller injected a generateTextImpl (legacy test path) or
  // if there's no Groq key.
  if (resolved.source === "groq" && env.groqApiKey && !opts.generateTextImpl) {
    const kind = pickStrictKind(input);
    try {
      const visual = await generateVisualGroqStrict(input, {
        apiKey: env.groqApiKey,
        kind,
        fetchImpl: opts.fetchImpl,
        recentBlock,
      });
      if (containsHedgeLanguage(visual.narration)) {
        throw new Error(`strict (${GROQ_MODELS.structured}/${kind}): hedge language detected in narration`);
      }
      if (isPromptLikeVisualText(visual.narration)) {
        throw new Error(`strict (${GROQ_MODELS.structured}/${kind}): prompt-like narration`);
      }
      return { visual, attempts: 1, warnings };
    } catch (err) {
      if (isBillingOrCreditError(err)) {
        throw new Error(
          `Groq rejected the request as unpaid/credits exhausted. Add credits or switch providers. (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to generate a valid visual via Groq strict mode (kind=${kind}): ${msg}`);
    }
  }


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
      if (normalized.visual.kind === "callout") {
        lastError = `kind="callout" is forbidden — slides must always carry a real visual asset. Return kind="diagram" (mindmap or flowchart), "table", "chart", or "math" with concrete on-screen content.`;
        warnings.push(`attempt ${attempt} (${modelId}): rejected callout (text-only slide)`);
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
        // Surface visibly — silent stubs were hiding real outages.
        throw new Error(
          `${resolved.source === "groq" ? "Groq" : "Lovable AI"} rejected the request as unpaid/credits exhausted. Add credits or switch providers. (${msg})`,
        );
      }
      lastError = msg;
      warnings.push(`attempt ${attempt} (${modelId}): ${msg}`);
    }
  }

  throw new Error(
    `Failed to generate a valid visual after ${maxAttempts} attempts via ${resolved.source}. Last error: ${lastError || "unknown"}. Warnings: ${warnings.join(" | ")}`,
  );
}
