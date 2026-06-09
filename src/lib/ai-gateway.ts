import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Groq is our primary subagent provider for visual + research generation.
 * It exposes an OpenAI-compatible endpoint with extremely low latency on
 * llama-3.1/3.3 models, which is what we want for fast diagram synthesis.
 */
export function createGroqProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
}

export interface AiProviderEnv {
  groqApiKey?: string;
  lovableApiKey?: string;
}

export type AiProvider = ReturnType<typeof createGroqProvider>;

export interface ResolvedAiProvider {
  provider: AiProvider;
  source: "groq" | "lovable";
}

/**
 * Pick the best available provider. Groq is preferred for its very low
 * latency on the subagent path. Lovable AI is kept as a fallback only when
 * GROQ_API_KEY is unset (mostly for tests + local installs without a Groq
 * key). Throws when neither is configured.
 */
export function resolveAiProvider(env: AiProviderEnv = readAiProviderEnv()): ResolvedAiProvider {
  if (env.groqApiKey) {
    return { provider: createGroqProvider(env.groqApiKey), source: "groq" };
  }
  if (env.lovableApiKey) {
    return { provider: createLovableAiGatewayProvider(env.lovableApiKey), source: "lovable" };
  }
  throw new Error(
    "No AI provider configured. Set GROQ_API_KEY (preferred) or LOVABLE_API_KEY.",
  );
}

export function readAiProviderEnv(): AiProviderEnv {
  return {
    groqApiKey: process.env.GROQ_API_KEY,
    lovableApiKey: process.env.LOVABLE_API_KEY,
  };
}

/**
 * Groq model IDs. We bias toward the fastest models that still produce
 * usable structured JSON — diagram generation is a small-context task,
 * not a deep-reasoning one.
 */
export const GROQ_MODELS = {
  // Fastest text model. Kept as legacy fallback for non-structured calls.
  fast: "llama-3.1-8b-instant",
  // Strong reasoning + tool calling.
  reasoning: "llama-3.3-70b-versatile",
  // Strict structured outputs (constrained decoding). Used for visual generation
  // so the schema is guaranteed and we stop wasting attempts on malformed JSON.
  // Per https://console.groq.com/docs/structured-outputs only openai/gpt-oss-*
  // support strict: true.
  structured: "openai/gpt-oss-20b",
} as const;

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Legacy Lovable AI gateway provider. Kept for tests that mock generateText
 * and for installations where Groq isn't configured.
 */
export const createLovableAiGatewayProvider = (lovableApiKey: string) =>
  createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableApiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
