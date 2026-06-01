import type { CanvasItem, CanvasSpec } from "./store";
import { useScholarStore } from "./store";

export interface ToolHost {
  // Send a contextual update to the live ElevenLabs agent so it can weave the result
  // into its current response without blocking.
  sendContextualUpdate: (text: string) => void;
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

function shouldRetryResearchError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return /non-JSON|upstream|timeout|temporar|network|fetch failed|\b5\d\d\b/i.test(message);
}

export async function parseResearchResponse(res: Response): Promise<ResearchApiResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text) as ResearchApiResponse;
  } catch {
    throw new Error(
      `Research service returned a non-JSON response (${res.status} ${res.statusText || "unknown status"}): ${responsePreview(text)}`,
    );
  }
}

export async function fetchResearchBriefing(
  payload: ResearchRequestPayload,
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; retryDelayMs?: number } = {},
) {
  const attempts = opts.attempts ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchImpl("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await parseResearchResponse(res);
      if (!res.ok || !json.ok) throw new Error(json.error ?? `research request failed (${res.status})`);
      return json;
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !shouldRetryResearchError(err)) break;
      if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("research failed");
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
          const res = await fetch("/api/illustrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              topic: params.topic,
              hint: params.hint,
              pdfExcerpt: ctx.text.slice(0, 30_000),
            }),
          });
          const json = (await res.json()) as {
            ok?: boolean;
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
            error?: string;
          };
          if (!json.ok || !json.visual) throw new Error(json.error ?? "no visual");
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
          host.sendContextualUpdate(
            `[VISUAL READY on canvas: "${v.title}" — ${v.narration}]`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          store().patchCanvas(id, { status: "error", error: msg });
          host.sendContextualUpdate(`[VISUAL FAILED for "${params.topic}": ${msg}]`);
        }
      })();

      return `Visualization "${params.topic}" queued. Keep talking; it will appear on the canvas in a few seconds.`;
    },

    research: (params: ResearchParams) => {
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
          });
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
          host.sendContextualUpdate(
            `[BACKGROUND RESEARCH on "${params.query}" — use this as factual grounding, do not read it verbatim]\n${json.summary ?? ""}${bullets}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          store().patchResearch(id, { status: "error", error: msg });
          host.sendContextualUpdate(`[RESEARCH FAILED for "${params.query}": ${msg}]`);
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
          const res = await fetch("/api/pdf-qa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: params.question,
              pdfText: ctx.text,
              pdfTitle: ctx.title,
            }),
          });
          const json = (await res.json()) as { ok?: boolean; answer?: string; error?: string };
          if (!json.ok) throw new Error(json.error ?? "deep think failed");
          store().patchResearch(id, {
            status: "ready",
            summary: json.answer,
          });
          host.sendContextualUpdate(
            `[DEEP_THINK RESULT for "${params.question}"]: ${json.answer ?? ""}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          store().patchResearch(id, { status: "error", error: msg });
          host.sendContextualUpdate(`[DEEP_THINK FAILED: ${msg}]`);
        }
      })();

      return `Working on it. I'll have the analysis in a moment.`;
    },
  };
}
