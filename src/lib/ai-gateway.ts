import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Cloudflare Workers AI also has an OpenAI-compatible endpoint, which we keep
 * for the research tool-calling path. Visual generation uses the native
 * /ai/run/{model} endpoint below because GLM-4.7-Flash is reliable there and
 * the OpenAI-compatible structured-output shim was producing malformed slides.
 */
export function createCloudflareAiProvider(opts: { apiToken: string; accountId: string }) {
  return createOpenAICompatible({
    name: "cloudflare-workers-ai",
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/v1`,
    headers: { Authorization: `Bearer ${opts.apiToken}` },
  });
}

export interface CloudflareRunTextOptions {
  apiToken: string;
  accountId: string;
  modelId: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

function previewBody(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500) || "empty response body";
}

export async function runCloudflareAiText(opts: CloudflareRunTextOptions): Promise<string> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${opts.modelId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          ...(opts.system ? [{ role: "system", content: opts.system }] : []),
          { role: "user", content: opts.prompt },
        ],
        response_format: { type: "json_object" },
        temperature: opts.temperature ?? 0.1,
        max_completion_tokens: opts.maxTokens ?? 4096,
      }),
    },
  );

  const body = await res.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`Cloudflare Workers AI returned non-JSON (${res.status} ${res.statusText}): ${previewBody(body)}`);
  }

  const envelope = payload as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: {
      response?: string;
      choices?: Array<{
        text?: string;
        message?: { content?: string | null };
      }>;
    };
  };

  if (!res.ok || envelope.success === false) {
    const msg = envelope.errors?.map((e) => e.message).filter(Boolean).join("; ") || previewBody(body);
    throw new Error(`Cloudflare Workers AI request failed (${res.status} ${res.statusText}): ${msg}`);
  }

  const choice = envelope.result?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? envelope.result?.response;
  if (!content) {
    throw new Error(`Cloudflare Workers AI returned no assistant content: ${previewBody(body)}`);
  }
  return content;
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
 * Cloudflare Workers AI model IDs we use across the app.
 */
export const CLOUDFLARE_MODELS = {
  // Primary model for visual generation and Cloudflare-backed agent calls.
  primary: "@cf/zai-org/glm-4.7-flash",
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
