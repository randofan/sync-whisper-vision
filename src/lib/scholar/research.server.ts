import { generateText, NoObjectGeneratedError, stepCountIs, tool } from "ai";
import { z } from "zod";
import {
  CLOUDFLARE_MODELS,
  resolveAiProvider,
  type AiProviderEnv,
  type ResolvedAiProvider,
} from "@/lib/ai-gateway";

export const ResearchSchema = z.object({
  summary: z
    .string()
    .min(1)
    .describe("Dense 4-8 sentence briefing for the voice agent. No URLs, no markdown links, no citation markers."),
  keyPoints: z
    .array(z.string())
    .max(10)
    .default([])
    .describe("Punchy factual bullets the voice agent can drop into a spoken response."),
});

export type ResearchResult = z.infer<typeof ResearchSchema>;

const LooseResearchSchema = z.object({
  summary: z.string().optional().nullable(),
  keyPoints: z
    .union([z.array(z.string()), z.string(), z.null()])
    .optional(),
});

export function normalizeResearch(
  raw: unknown,
): { ok: true; result: ResearchResult } | { ok: false; reason: string } {
  const parsed = LooseResearchSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `loose schema rejected: ${parsed.error.message}` };
  }
  const r = parsed.data;
  const summary = (r.summary ?? "").trim();
  if (!summary) return { ok: false, reason: "summary missing or empty" };

  let keyPoints: string[] = [];
  if (Array.isArray(r.keyPoints)) keyPoints = r.keyPoints.filter((s) => typeof s === "string" && s.trim().length > 0);
  else if (typeof r.keyPoints === "string" && r.keyPoints.trim()) keyPoints = [r.keyPoints.trim()];
  keyPoints = keyPoints.slice(0, 10);

  return { ok: true, result: { summary, keyPoints } };
}

// ---- tools the research agent uses to do real discovery ----

async function fetchArxiv(query: string, maxResults = 6): Promise<
  Array<{ title: string; url: string; summary: string; authors: string }>
> {
  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(
    "all:" + query,
  )}&max_results=${maxResults}&sortBy=relevance`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map((e) => {
    const block = e[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
    const link = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
    const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 600);
    const authors = [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)]
      .map((m) => m[1].trim())
      .slice(0, 4)
      .join(", ");
    return { title, url: link, summary, authors };
  });
}

async function fetchUrlExcerpt(url: string, maxChars = 4000): Promise<string> {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return `[unsupported protocol: ${u.protocol}]`;
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (Lovable research agent)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return `[fetch failed: ${res.status} ${res.statusText}]`;
    const ct = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    if (ct.includes("html")) {
      const stripped = raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return stripped.slice(0, maxChars);
    }
    return raw.slice(0, maxChars);
  } catch (err) {
    return `[fetch error: ${err instanceof Error ? err.message : "unknown"}]`;
  }
}

const SYNTHESIS_SYSTEM = `You are a deep-research librarian feeding factual grounding to a live voice agent.

Workflow:
1. Use the "arxiv_search" tool 1-3 times with different focused query phrasings to find relevant primary literature.
2. Use the "fetch_url" tool 1-3 times to read promising abstracts or referenced pages in depth.
3. After gathering evidence, produce the final JSON briefing as your last assistant message.

Final output rules (strict):
- Your FINAL assistant message MUST be a single JSON object and NOTHING ELSE — no prose before or after, no markdown fences. Shape:
  {"summary": "<4-8 dense sentences>", "keyPoints": ["bullet", "bullet", ...]}
- "summary" is REQUIRED and non-empty: 4-8 dense sentences synthesizing what you actually verified from the tools. Mention concrete techniques, prior work names, numbers, or definitions. NO URLs, NO markdown link syntax, NO citation markers like [1] or (Smith 2024). The voice agent will speak this aloud.
- "keyPoints": 3-7 short factual bullets, same constraints (no URLs, no link syntax).
- Do not output citations or bibliography — the voice agent doesn't need them. The briefing must read as confident grounded knowledge.
- If your tool calls returned nothing useful, STILL produce a best-effort grounded summary from your training knowledge. Never return an empty summary.`;

export interface ResearchInput {
  query: string;
  pdfExcerpt?: string;
}

export interface ResearchRunResult {
  result: ResearchResult;
  attempts: number;
  warnings: string[];
  toolCalls: number;
}

type GenerateTextLike = (args: Record<string, unknown>) => Promise<{
  experimental_output?: unknown;
  text?: string;
}>;

export function createFallbackResearch(input: ResearchInput): ResearchResult {
  const excerpt = input.pdfExcerpt?.replace(/\s+/g, " ").trim();
  const summary = excerpt
    ? `Background research is temporarily unavailable, so this briefing is grounded in the uploaded paper excerpt. For "${input.query}", the relevant context is: ${excerpt.slice(0, 700)}`
    : `Background research is temporarily unavailable. Use the uploaded paper as the primary source while answering this query: ${input.query}`;
  return {
    summary,
    keyPoints: [
      "External research generation is unavailable right now.",
      "Continue from the uploaded paper context instead of blocking the conversation.",
    ],
  };
}

function isBillingOrCreditError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b402\b|payment required|billing|credits? exhausted|insufficient credits|add credits/i.test(msg);
}

/**
 * Pull a JSON object out of a free-form assistant message. Cloudflare GLM
 * sometimes wraps the JSON in ```json fences or prepends a short sentence, and
 * occasionally drops the trailing brace when the response is near the token
 * limit. Strip fences, walk to the first { / [, then find the matching close,
 * with light repairs for trailing commas and stripped control characters.
 */
export function extractJsonFromText(raw: string): unknown {
  if (!raw) return undefined;
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) return undefined;
  const openChar = cleaned[start];
  const closeChar = openChar === "[" ? "]" : "}";
  let end = cleaned.lastIndexOf(closeChar);
  if (end < start) {
    // Likely truncated — append the missing close so JSON.parse has a chance.
    cleaned = cleaned + closeChar;
    end = cleaned.length - 1;
  }
  let candidate = cleaned.substring(start, end + 1);
  const attempts = [
    candidate,
    candidate.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"),
    candidate
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\x00-\x1F\x7F]/g, " "),
  ];
  for (const text of attempts) {
    try {
      return JSON.parse(text);
    } catch {
      // try next repair
    }
  }
  return undefined;
}

export async function generateResearch(
  input: ResearchInput,
  opts: {
    apiKey?: string;
    env?: AiProviderEnv;
    resolvedProvider?: ResolvedAiProvider;
    maxAttempts?: number;
    maxSteps?: number;
    generateTextImpl?: GenerateTextLike;
  } = {},
): Promise<ResearchRunResult> {
  const resolved =
    opts.resolvedProvider ??
    resolveAiProvider(
      opts.env ?? {
        cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
        cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        lovableApiKey: opts.apiKey || process.env.LOVABLE_API_KEY,
      },
    );

  const maxAttempts = opts.maxAttempts ?? 3;
  const maxSteps = opts.maxSteps ?? 8;
  const runGenerateText = (opts.generateTextImpl ?? generateText) as GenerateTextLike;

  const models =
    resolved.source === "cloudflare"
      ? [CLOUDFLARE_MODELS.primary]
      : ["google/gemini-2.5-flash", "google/gemini-2.5-pro", "google/gemini-3-flash-preview"];

  const warnings: string[] = [];
  let lastError = "";
  let toolCallCount = 0;

  const tools = {
    arxiv_search: tool({
      description:
        "Search arXiv for primary research papers relevant to a query. Returns title, abstract excerpt, authors, and URL. Use this to find prior work and competing approaches.",
      inputSchema: z.object({
        query: z.string().describe("Focused search phrase, e.g. 'lossless LLM weight compression mixture of experts'"),
      }),
      execute: async ({ query }: { query: string }) => {
        toolCallCount++;
        const hits = await fetchArxiv(query, 6);
        return {
          count: hits.length,
          results: hits.map((h) => ({
            title: h.title,
            authors: h.authors,
            abstract: h.summary,
            url: h.url,
          })),
        };
      },
    }),
    fetch_url: tool({
      description:
        "Fetch and extract text from a webpage URL (arxiv abstract page, doc, blog post). Use to read more depth on a promising source surfaced by arxiv_search.",
      inputSchema: z.object({
        url: z.string().describe("Full https:// URL to fetch"),
      }),
      execute: async ({ url }: { url: string }) => {
        toolCallCount++;
        const excerpt = await fetchUrlExcerpt(url, 4000);
        return { url, excerpt };
      },
    }),
  } as const;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const modelId = models[Math.min(attempt - 1, models.length - 1)];
    const model = resolved.provider(modelId);
    const correction = lastError
      ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError}\nProduce a corrected JSON briefing that matches the schema exactly.`
      : "";
    const prompt = `Research query: ${input.query}
${input.pdfExcerpt ? `\nThe user is reading this paper (excerpt):\n${input.pdfExcerpt.slice(0, 3500)}\n` : ""}
Investigate using the available tools, then return the JSON briefing.${correction}`;

    try {
      const { text } = await runGenerateText({
        model,
        tools,
        stopWhen: stepCountIs(maxSteps),
        system: SYNTHESIS_SYSTEM,
        prompt,
      });
      const loose = extractJsonFromText(text ?? "");
      if (!loose) {
        lastError = `model returned no parseable JSON briefing. Raw text: ${(text ?? "").slice(0, 400)}`;
        warnings.push(`attempt ${attempt} (${modelId}): no parseable JSON`);
        continue;
      }
      const normalized = normalizeResearch(loose);
      if (!normalized.ok) {
        lastError = normalized.reason;
        warnings.push(`attempt ${attempt} (${modelId}): ${normalized.reason}`);
        continue;
      }
      return {
        result: normalized.result,
        attempts: attempt,
        warnings,
        toolCalls: toolCallCount,
      };
    } catch (err) {
      const msg =
        err instanceof NoObjectGeneratedError
          ? `model returned non-conforming JSON (${err.message}). Raw text: ${(err.text ?? "").slice(0, 400)}`
          : err instanceof Error
            ? err.message
            : "unknown generation error";
      if (isBillingOrCreditError(err)) {
        throw new Error(
          `${resolved.source === "cloudflare" ? "Cloudflare Workers AI" : "Lovable AI"} rejected the research request as unpaid/credits exhausted. Add credits or switch providers. (${msg})`,
        );
      }
      lastError = msg;
      warnings.push(`attempt ${attempt} (${modelId}): ${msg}`);
    }
  }

  throw new Error(
    `Failed to generate a valid research briefing after ${maxAttempts} attempts via ${resolved.source}. Last error: ${lastError || "unknown"}. Warnings: ${warnings.join(" | ")}`,
  );
}
