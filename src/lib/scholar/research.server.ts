import { generateText, Output, NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

export const CitationSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  snippet: z.string().optional(),
});

export const ResearchSchema = z.object({
  summary: z.string().min(1).describe("2-4 sentence synthesis of findings"),
  keyPoints: z.array(z.string()).max(8).default([]),
  citations: z.array(CitationSchema).max(8).default([]),
});

export type ResearchResult = z.infer<typeof ResearchSchema>;

// Permissive schema: models often shortcut keyPoints to a string, omit fields,
// emit null instead of [], or include malformed URLs. We normalize before strict validation.
const LooseResearchSchema = z.object({
  summary: z.string().optional().nullable(),
  keyPoints: z
    .union([z.array(z.string()), z.string(), z.null()])
    .optional(),
  citations: z
    .union([
      z.array(
        z.object({
          title: z.string().optional().nullable(),
          url: z.string().optional().nullable(),
          snippet: z.string().optional().nullable(),
        }),
      ),
      z.null(),
    ])
    .optional(),
});

function isValidUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

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
  keyPoints = keyPoints.slice(0, 8);

  const citationsRaw = Array.isArray(r.citations) ? r.citations : [];
  const citations = citationsRaw
    .map((c) => ({
      title: (c.title ?? "").trim(),
      url: (c.url ?? "").trim(),
      snippet: c.snippet?.trim() || undefined,
    }))
    .filter((c) => c.title && isValidUrl(c.url))
    .slice(0, 8);

  return { ok: true, result: { summary, keyPoints, citations } };
}

const SYSTEM_PROMPT = `You are a research librarian. Synthesize what's known about a topic.

Output rules (strict):
- "summary": 2-4 sentences, concise and technical.
- "keyPoints": array of 3-5 short bullet strings.
- "citations": array of up to 5 objects. Each MUST have:
    - "title": non-empty string
    - "url": a real, full URL starting with "https://" (prefer arxiv.org, doi.org, well-known journals, official project pages, .edu). NEVER invent URLs — if you are not certain a URL exists, omit that citation entirely.
    - "snippet" (optional): one sentence.
- Return an empty array [] for citations if you cannot produce verifiable URLs. Do NOT return null.
- Return ONLY the JSON object matching the schema.`;

export interface ResearchInput {
  query: string;
  pdfExcerpt?: string;
}

export interface ResearchRunResult {
  result: ResearchResult;
  attempts: number;
  warnings: string[];
}

export async function generateResearch(
  input: ResearchInput,
  opts: { apiKey?: string; maxAttempts?: number } = {},
): Promise<ResearchRunResult> {
  const apiKey = opts.apiKey || process.env.LOVABLE_API_KEY || "";
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const maxAttempts = opts.maxAttempts ?? 4;
  const gateway = createLovableAiGatewayProvider(apiKey);

  const models = [
    "google/gemini-2.5-flash",
    "google/gemini-3-flash-preview",
    "google/gemini-2.5-pro",
  ];

  const warnings: string[] = [];
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const modelId = models[Math.min(attempt - 1, models.length - 1)];
    const model = gateway(modelId);
    const correction = lastError
      ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError}\nReturn a corrected JSON object that exactly matches the schema. If you have no verifiable URLs, set citations to [].`
      : "";
    const prompt = `Research query: ${input.query}
${input.pdfExcerpt ? `\nContext from the paper the user is reading:\n${input.pdfExcerpt.slice(0, 4000)}\n` : ""}
Provide the JSON object.${correction}`;

    try {
      const { experimental_output: rawOut, text } = await generateText({
        model,
        experimental_output: Output.object({ schema: LooseResearchSchema }),
        system: SYSTEM_PROMPT,
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
        lastError = "model returned no parseable JSON object";
        warnings.push(`attempt ${attempt} (${modelId}): ${lastError}`);
        continue;
      }
      const normalized = normalizeResearch(loose);
      if (!normalized.ok) {
        lastError = normalized.reason;
        warnings.push(`attempt ${attempt} (${modelId}): ${normalized.reason}`);
        continue;
      }
      return { result: normalized.result, attempts: attempt, warnings };
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

export async function searchArxiv(query: string): Promise<Array<{ title: string; url: string; snippet?: string }>> {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent("all:" + query)}&max_results=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    return entries.slice(0, 5).map((e) => {
      const block = e[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const link = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
      const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
      return { title, url: link, snippet: summary };
    }).filter((e) => e.title && isValidUrl(e.url));
  } catch {
    return [];
  }
}

export function mergeCitations(
  primary: ResearchResult["citations"],
  extra: Array<{ title: string; url: string; snippet?: string }>,
): ResearchResult["citations"] {
  const seen = new Set(primary.map((c) => c.url));
  const out = [...primary];
  for (const a of extra) {
    if (out.length >= 8) break;
    if (!seen.has(a.url)) {
      out.push(a);
      seen.add(a.url);
    }
  }
  return out;
}
