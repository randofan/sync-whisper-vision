import type { CanvasItem, CanvasSpec } from "./store";
import { useScholarStore } from "./store";

export interface ToolHost {
  // Send a contextual update to the live ElevenLabs agent so it can weave the result
  // into its current response without blocking.
  sendContextualUpdate: (text: string) => void;
  canSendContextualUpdate?: () => boolean;
  queueContextualUpdate?: (text: string) => void;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

interface IllustrateParams {
  topic: string;
  hint?: string;
}

interface ResearchParams {
  query: string;
  scope?: "web" | "citations" | "both";
}

interface ResearchRequestPayload {
  query: string;
  pdfExcerpt?: string;
  scope?: "web" | "citations" | "both";
}

interface ResearchApiResponse {
  ok?: boolean;
  summary?: string;
  keyPoints?: string[];
  error?: string;
}

interface DeepThinkParams {
  question: string;
}

function getPdfContext() {
  const pdf = useScholarStore.getState().pdf;
  return {
    text: pdf?.text ?? "",
    title: pdf?.name ?? "",
  };
}

function responsePreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180) || "empty response body";
}

function shouldRetryTransientError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /non-JSON|upstream|timeout|temporar|network|fetch failed|\b5\d\d\b/i.test(message);
}

// Back-compat alias used in existing tests.
export const shouldRetryResearchError = shouldRetryTransientError;

/**
 * Safely parse a fetch Response as JSON. If the body isn't JSON (e.g. the
 * upstream gateway returned plain text like "upstream request timeout"),
 * throw a controlled error that names the endpoint, status, and a preview
 * of the body — never let `res.json()` blow up with a cryptic SyntaxError.
 */
export async function parseJsonResponse<T>(res: Response, label = "service"): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `${label} returned a non-JSON response (${res.status} ${res.statusText || "unknown status"}): ${responsePreview(text)}`,
    );
  }
}

export async function parseResearchResponse(res: Response): Promise<ResearchApiResponse> {
  return parseJsonResponse<ResearchApiResponse>(res, "Research service");
}

/**
 * POST JSON to an endpoint with retry on transient/non-JSON failures. All
 * tool client fetches (illustrate, research, pdf-qa) MUST go through this so
 * no caller ever calls `res.json()` directly on a possibly-non-JSON response.
 */
export async function postJsonWithRetry<TResp>(
  url: string,
  body: unknown,
  label: string,
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; retryDelayMs?: number } = {},
): Promise<TResp> {
  const attempts = opts.attempts ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await parseJsonResponse<TResp & { ok?: boolean; error?: string }>(res, label);
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? `${label} request failed (${res.status})`);
      }
      return json;
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !shouldRetryTransientError(err)) break;
      if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

export async function fetchResearchBriefing(
  payload: ResearchRequestPayload,
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; retryDelayMs?: number } = {},
) {
  return postJsonWithRetry<ResearchApiResponse>(
    "/api/research",
    payload,
    "Research service",
    fetchImpl,
    { attempts: 1, ...opts },
  );
}

interface IllustrateApiResponse {
  ok?: boolean;
  error?: string;
  visual?: {
    title: string;
    narration: string;
    kind: CanvasSpec["kind"];
    chart?: unknown;
    math?: unknown;
    diagram?: unknown;
    table?: unknown;
    callout?: unknown;
  };
}

export async function fetchIllustration(
  payload: {
    topic: string;
    hint?: string;
    pdfExcerpt?: string;
    recentVisuals?: Array<{ title: string; kind: CanvasSpec["kind"] }>;
  },
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; retryDelayMs?: number } = {},
) {
  return postJsonWithRetry<IllustrateApiResponse>(
    "/api/illustrate",
    payload,
    "Illustrate service",
    fetchImpl,
    opts,
  );
}

interface DeepThinkApiResponse {
  ok?: boolean;
  error?: string;
  answer?: string;
}

export async function fetchDeepThink(
  payload: { question: string; pdfText: string; pdfTitle: string },
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; retryDelayMs?: number } = {},
) {
  return postJsonWithRetry<DeepThinkApiResponse>(
    "/api/pdf-qa",
    payload,
    "Deep-think service",
    fetchImpl,
    opts,
  );
}

export function deliverContextualUpdate(host: ToolHost, text: string) {
  if (host.canSendContextualUpdate && !host.canSendContextualUpdate()) {
    host.queueContextualUpdate?.(text);
    return false;
  }
  try {
    host.sendContextualUpdate(text);
    return true;
  } catch (err) {
    host.queueContextualUpdate?.(text);
    if (!host.queueContextualUpdate) console.warn("contextual update dropped", err);
    return false;
  }
}


export function buildClientTools(host: ToolHost) {
  const store = useScholarStore.getState;

  return {
    visualize: (params: IllustrateParams) => {
      const id = uid("vis");
      const item: CanvasItem = {
        id,
        title: params.topic,
        narration: params.hint ?? "",
        createdAt: Date.now(),
        status: "pending",
      };
      store().upsertCanvas(item);

      // Fire-and-forget — DO NOT await; tool returns immediately.
      void (async () => {
        try {
          const ctx = getPdfContext();
          const recentVisuals = store()
            .canvasItems.filter((c) => c.id !== id && c.status === "ready" && !!c.payload)
            .slice(0, 6)
            .map((c) => ({ title: c.title, kind: c.payload!.kind }));
          const json = await fetchIllustration({
            topic: params.topic,
            hint: params.hint,
            pdfExcerpt: ctx.text.slice(0, 30_000),
            recentVisuals,
          });
          if (!json.visual) throw new Error(json.error ?? "no visual");
          const v = json.visual;

          const payload =
            v.kind === "chart"
              ? ({ kind: "chart", spec: v.chart } as CanvasSpec)
              : v.kind === "math"
                ? ({ kind: "math", spec: v.math } as CanvasSpec)
                : v.kind === "diagram"
                  ? ({ kind: "diagram", spec: v.diagram } as CanvasSpec)
                  : v.kind === "table"
                    ? ({ kind: "table", spec: v.table } as CanvasSpec)
                    : ({ kind: "callout", spec: v.callout } as CanvasSpec);
          store().patchCanvas(id, {
            status: "ready",
            title: v.title || params.topic,
            narration: v.narration || params.hint || "",
            payload,
          });
          deliverContextualUpdate(
            host,
            `[VISUAL READY on canvas: "${v.title}" — ${v.narration}]`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          store().patchCanvas(id, { status: "error", error: msg });
          deliverContextualUpdate(host, `[VISUAL FAILED for "${params.topic}": ${msg}]`);
        }
      })();

      return `Visualization "${params.topic}" queued. Keep talking; it will appear on the canvas in a few seconds.`;
    },

    research: (params: ResearchParams) => {
      const activeResearch = store().researchItems.find(
        (item) => item.status === "pending" && !item.query.startsWith("Deep reasoning:"),
      );
      if (activeResearch) {
        return `Research already in progress. Continue speaking; do not dispatch another research query for this turn.`;
      }

      const id = uid("res");
      store().upsertResearch({
        id,
        query: params.query,
        status: "pending",
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const ctx = getPdfContext();
          const json = await fetchResearchBriefing({
            query: params.query,
            pdfExcerpt: ctx.text.slice(0, 12_000),
            scope: params.scope,
          }, fetch, { attempts: 1 });
          store().patchResearch(id, {
            status: "ready",
            summary: json.summary,
          });
          // Stream the FULL briefing back as grounding for the voice agent.
          // No URLs/citations — those would only get spoken aloud awkwardly.
          const bullets =
            json.keyPoints && json.keyPoints.length > 0
              ? `\nKey facts:\n- ${json.keyPoints.join("\n- ")}`
              : "";
          deliverContextualUpdate(
            host,
            `[BACKGROUND RESEARCH on "${params.query}" — use this as factual grounding, do not read it verbatim]\n${json.summary ?? ""}${bullets}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          store().patchResearch(id, { status: "error", error: msg });
          deliverContextualUpdate(host, `[RESEARCH FAILED for "${params.query}": ${msg}]`);
        }
      })();

      return `Research query "${params.query}" dispatched. Continue speaking; findings will arrive shortly.`;
    },


    deep_think: (params: DeepThinkParams) => {
      const id = uid("think");
      store().upsertResearch({
        id,
        query: `Deep reasoning: ${params.question}`,
        status: "pending",
        createdAt: Date.now(),
      });

      void (async () => {
        try {
          const ctx = getPdfContext();
          const json = await fetchDeepThink({
            question: params.question,
            pdfText: ctx.text,
            pdfTitle: ctx.title,
          });
          if (!json.answer) throw new Error(json.error ?? "deep think failed");

          store().patchResearch(id, {
            status: "ready",
            summary: json.answer,
          });
          deliverContextualUpdate(
            host,
            `[DEEP_THINK RESULT for "${params.question}"]: ${json.answer ?? ""}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          store().patchResearch(id, { status: "error", error: msg });
          deliverContextualUpdate(host, `[DEEP_THINK FAILED: ${msg}]`);
        }
      })();

      return `Working on it. I'll have the analysis in a moment.`;
    },
  };
}
