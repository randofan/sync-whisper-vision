import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Cloudflare Workers AI exposes an OpenAI-compatible endpoint under
 * /accounts/{id}/ai/v1. We use that as the primary AI gateway for this app
 * because Lovable AI credits are exhausted and topping them up isn't viable
 * for this user. Auth is a bearer token created in Cloudflare with the
 * "Workers AI" permission.
 */
export function createCloudflareAiProvider(opts: { apiToken: string; accountId: string }) {
  return createOpenAICompatible({
    name: "cloudflare-workers-ai",
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/v1`,
    headers: { Authorization: `Bearer ${opts.apiToken}` },
  });
}

export interface AiProviderEnv {
  cloudflareApiToken?: string;
  cloudflareAccountId?: string;
  lovableApiKey?: string;
}

export type AiProvider = ReturnType<typeof createCloudflareAiProvider>;

export interface ResolvedAiProvider {
  provider: AiProvider;
  source: "cloudflare" | "lovable";
}

/**
 * Pick the best available provider. Cloudflare wins when both Cloudflare creds
 * are configured; otherwise we fall back to Lovable AI. Throws when neither is
 * available so callers surface the failure visibly instead of silently
 * fabricating stub content.
 */
export function resolveAiProvider(env: AiProviderEnv = readAiProviderEnv()): ResolvedAiProvider {
  if (env.cloudflareApiToken && env.cloudflareAccountId) {
    return {
      provider: createCloudflareAiProvider({
        apiToken: env.cloudflareApiToken,
        accountId: env.cloudflareAccountId,
      }),
      source: "cloudflare",
    };
  }
  if (env.lovableApiKey) {
    return { provider: createLovableAiGatewayProvider(env.lovableApiKey), source: "lovable" };
  }
  throw new Error(
    "No AI provider configured. Set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (preferred) or LOVABLE_API_KEY.",
  );
}

export function readAiProviderEnv(): AiProviderEnv {
  return {
    cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    lovableApiKey: process.env.LOVABLE_API_KEY,
  };
}

/**
 * Cloudflare Workers AI model IDs we use across the app. All of these support
 * tool calling and JSON / structured output via the OpenAI-compatible
 * /v1/chat/completions endpoint.
 */
export const CLOUDFLARE_MODELS = {
  // Primary chat: strong instruction following with function calling, fp8 fast.
  primary: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  // Retry with a different model family to get an independent attempt.
  secondary: "@cf/meta/llama-4-scout-17b-16e-instruct",
  // Final retry with a function-calling-tuned smaller model.
  tertiary: "@hf/nousresearch/hermes-2-pro-mistral-7b",
} as const;

/**
 * Legacy Lovable AI gateway provider. Kept for tests that mock generateText
 * and for installations where Cloudflare isn't configured.
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
