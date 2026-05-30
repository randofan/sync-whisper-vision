import {
  generateText,
  Output,
  NoObjectGeneratedError,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

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
3. After gathering evidence, produce the final JSON briefing.

Final output rules (strict):
- "summary": 4-8 dense sentences synthesizing what you actually verified from the tools. Mention concrete techniques, prior work names, numbers, or definitions. NO URLs, NO markdown link syntax, NO citation markers like [1] or (Smith 2024). The voice agent will speak this aloud.
- "keyPoints": 3-7 short factual bullets, same constraints (no URLs, no link syntax).
- Do not output citations or bibliography — the voice agent doesn't need them. The briefing must read as confident grounded knowledge.
- If your tool calls returned nothing useful, still produce a best-effort grounded summary from your training knowledge and say so honestly.`;

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

export async function generateResearch(
  input: ResearchInput,
  opts: { apiKey?: string; maxAttempts?: number; maxSteps?: number } = {},
): Promise<ResearchRunResult> {
  const apiKey = opts.apiKey || process.env.LOVABLE_API_KEY || "";
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const maxAttempts = opts.maxAttempts ?? 3;
  const maxSteps = opts.maxSteps ?? 8;
  const gateway = createLovableAiGatewayProvider(apiKey);

  const models = [
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "google/gemini-3-flash-preview",
  ];

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
    const model = gateway(modelId);
    const correction = lastError
      ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError}\nProduce a corrected JSON briefing that matches the schema exactly.`
      : "";
    const prompt = `Research query: ${input.query}
${input.pdfExcerpt ? `\nThe user is reading this paper (excerpt):\n${input.pdfExcerpt.slice(0, 3500)}\n` : ""}
Investigate using the available tools, then return the JSON briefing.${correction}`;

    try {
      const { experimental_output: rawOut, text } = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(maxSteps),
        experimental_output: Output.object({ schema: LooseResearchSchema }),
        system: SYNTHESIS_SYSTEM,
        prompt,
      });
      let loose: unknown = rawOut;
      if (!loose && text) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            loose = JSON.parse(match[0]);
          } catch {
            // fall through
          }
        }
      }
      if (!loose) {
        lastError = "model returned no parseable JSON briefing";
        warnings.push(`attempt ${attempt} (${modelId}): ${lastError}`);
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
      lastError = msg;
      warnings.push(`attempt ${attempt} (${modelId}): ${msg}`);
    }
  }

  throw new Error(`Failed to generate research after ${maxAttempts} attempts. Last error: ${lastError}`);
}
