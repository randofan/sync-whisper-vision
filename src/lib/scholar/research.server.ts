import { GoogleGenAI, Type } from "@google/genai";
import { z } from "zod";

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
  if (Array.isArray(r.keyPoints))
    keyPoints = r.keyPoints.filter((s) => typeof s === "string" && s.trim().length > 0);
  else if (typeof r.keyPoints === "string" && r.keyPoints.trim())
    keyPoints = [r.keyPoints.trim()];
  keyPoints = keyPoints.slice(0, 10);

  return { ok: true, result: { summary, keyPoints } };
}

const SYNTHESIS_SYSTEM = `You are a deep-research librarian feeding factual grounding to a live voice agent.

Synthesize from your training knowledge — you do NOT have web search available on this call. Be confident and concrete; do not hedge about lack of information.

Final output rules (strict):
- Return a single JSON object matching the schema: {"summary": string, "keyPoints": string[]}.
- "summary" is REQUIRED and non-empty: 4-8 dense sentences. Mention concrete techniques, prior work names, numbers, or definitions. NO URLs, NO markdown link syntax, NO citation markers like [1] or (Smith 2024). The voice agent will speak this aloud.
- "keyPoints": 3-7 short factual bullets, same constraints (no URLs, no link syntax, no citations).
- Do not output a bibliography. The briefing must read as confident grounded knowledge.`;

export interface ResearchInput {
  query: string;
  pdfExcerpt?: string;
}

export interface ResearchRunResult {
  result: ResearchResult;
  attempts: number;
  warnings: string[];
  /**
   * Kept for API compatibility with the previous tool-using implementation.
   * Gemini's googleSearch grounding is opaque, so this is always 0.
   */
  toolCalls: number;
}

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
  return /\b402\b|payment required|billing|credits? exhausted|insufficient credits|add credits|quota/i.test(msg);
}

/** Robust JSON extraction. Gemini may wrap fenced JSON or prepend prose when
 *  Google Search grounding is enabled (it can't strictly enforce the
 *  response schema in that combination). */
export function extractJsonFromText(raw: string): unknown {
  if (!raw) return undefined;
  let cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) return undefined;
  const openChar = cleaned[start];
  const closeChar = openChar === "[" ? "]" : "}";
  let end = cleaned.lastIndexOf(closeChar);
  if (end < start) {
    cleaned = cleaned + closeChar;
    end = cleaned.length - 1;
  }
  const candidate = cleaned.substring(start, end + 1);
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

/**
 * Minimal contract for the Gemini call we make. Lets tests inject a mock
 * without instantiating the real `GoogleGenAI` client.
 */
export type GeminiGenerateContent = (args: {
  model: string;
  contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  config: Record<string, unknown>;
}) => Promise<{ text?: string }>;

function defaultGeminiImpl(apiKey: string): GeminiGenerateContent {
  const ai = new GoogleGenAI({ apiKey });
  return (args) => ai.models.generateContent(args);
}

const GEMINI_MODELS = [
  "gemini-3.1-flash-lite",
] as const;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ["summary", "keyPoints"],
  properties: {
    summary: { type: Type.STRING },
    keyPoints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
} as const;

export async function generateResearch(
  input: ResearchInput,
  opts: {
    apiKey?: string;
    maxAttempts?: number;
    generateContentImpl?: GeminiGenerateContent;
  } = {},
): Promise<ResearchRunResult> {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No AI provider configured. Set GEMINI_API_KEY to use the research agent.",
    );
  }

  const maxAttempts = Math.min(opts.maxAttempts ?? 1, 1);
  const generateContent = opts.generateContentImpl ?? defaultGeminiImpl(apiKey);

  const warnings: string[] = [];
  let lastError = "";

  // Per the official @google/genai snippet, googleSearch grounding CAN be
  // combined with responseMimeType + responseSchema. Use both so the model
  // returns parseable JSON directly without prompt-based JSON discipline.
  const baseConfig: Record<string, unknown> = {
    tools: [{ googleSearch: {} }],
    thinkingConfig: { thinkingLevel: "low" },
    responseMimeType: "application/json",
    responseSchema: RESPONSE_SCHEMA,
    systemInstruction: SYNTHESIS_SYSTEM,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const modelId = GEMINI_MODELS[Math.min(attempt - 1, GEMINI_MODELS.length - 1)];
    const correction = lastError
      ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError}\nProduce a corrected JSON briefing that matches the schema exactly.`
      : "";
    const userText = `Research query: ${input.query}
${input.pdfExcerpt ? `\nThe user is reading this paper (excerpt):\n${input.pdfExcerpt.slice(0, 3500)}\n` : ""}
Investigate using Google Search, then return a JSON object matching the schema (summary + keyPoints). No URLs or citations in the values.${correction}`;

    try {
      const { text } = await generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: userText }] }],
        config: baseConfig,
      });
      // Structured output should already be JSON, but fall back to extraction
      // in case the model wraps it in prose.
      let parsed: unknown;
      try {
        parsed = JSON.parse(text ?? "");
      } catch {
        parsed = extractJsonFromText(text ?? "");
      }
      if (!parsed) {
        lastError = `model returned no parseable JSON briefing. Raw text: ${(text ?? "").slice(0, 400)}`;
        warnings.push(`attempt ${attempt} (${modelId}): no parseable JSON`);
        continue;
      }
      const normalized = normalizeResearch(parsed);
      if (!normalized.ok) {
        lastError = normalized.reason;
        warnings.push(`attempt ${attempt} (${modelId}): ${normalized.reason}`);
        continue;
      }
      return {
        result: normalized.result,
        attempts: attempt,
        warnings,
        toolCalls: 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown generation error";
      if (isBillingOrCreditError(err)) {
        throw new Error(
          `Gemini rejected the research request as unpaid/credits exhausted or out of quota. (${msg})`,
        );
      }
      lastError = msg;
      warnings.push(`attempt ${attempt} (${modelId}): ${msg}`);
    }
  }

  throw new Error(
    `Failed to generate a valid research briefing after ${maxAttempts} attempts via Gemini. Last error: ${lastError || "unknown"}. Warnings: ${warnings.join(" | ")}`,
  );
}

export const _internals = { extractJsonFromText, GEMINI_MODELS, RESPONSE_SCHEMA };

export { Type };

