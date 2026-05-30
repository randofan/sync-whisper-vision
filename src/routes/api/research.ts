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
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
            status: 500,
            headers: corsHeaders,
          });
        }

        try {
          const { result, attempts, warnings, toolCalls } = await generateResearch(
            { query, pdfExcerpt: body.pdfExcerpt },
            { apiKey },
          );

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
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },
    },
  },
});
