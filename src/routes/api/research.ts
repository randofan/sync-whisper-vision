import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { generateResearch } from "@/lib/scholar/research.server";

const corsHeaders = { "Content-Type": "application/json" };

interface ReqBody {
  query?: string;
  pdfExcerpt?: string;
  scope?: "web" | "citations" | "both";
}

export const Route = createFileRoute("/api/research")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as ReqBody;
        const query = body.query?.trim();
        if (!query) {
          return new Response(JSON.stringify({ error: "query required" }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        try {
          const { result, attempts, warnings, toolCalls } = await generateResearch({
            query,
            pdfExcerpt: body.pdfExcerpt,
          });

          if (warnings.length > 0) {
            console.warn("research retries", warnings);
          }
          console.log(
            `research ok: attempts=${attempts} toolCalls=${toolCalls} summaryChars=${result.summary.length} keyPoints=${result.keyPoints.length}`,
          );

          return new Response(
            JSON.stringify({ ok: true, ...result, attempts, toolCalls }),
            { status: 200, headers: corsHeaders },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error("research error", msg);
          // Classify upstream provider failures (quota/rate-limit/credits/5xx)
          // as a graceful degradation: return 200 + fallback so the route does
          // not surface as a runtime 500 to the client. The voice agent's
          // research tool already handles { ok: false } by reporting the
          // failure to the user and moving on.
          const isUpstreamDegraded =
            /quota|rate[- ]?limit|RESOURCE_EXHAUSTED|credits? exhausted|unpaid|429|503|temporarily unavailable/i.test(
              msg,
            );
          if (isUpstreamDegraded) {
            return new Response(
              JSON.stringify({
                ok: false,
                fallback: true,
                error:
                  "Background research is temporarily unavailable (upstream quota or rate limit). Continuing without web grounding.",
                detail: msg,
              }),
              { status: 200, headers: corsHeaders },
            );
          }
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },
    },
  },
});
