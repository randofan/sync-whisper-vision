import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { generateVisual } from "@/lib/scholar/illustrate.server";

const corsHeaders = { "Content-Type": "application/json" };

interface ReqBody {
  topic?: string;
  hint?: string;
  pdfExcerpt?: string;
}

export const Route = createFileRoute("/api/illustrate")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as ReqBody;
        const topic = body.topic?.trim();
        if (!topic) {
          return new Response(JSON.stringify({ error: "topic required" }), {
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
          const result = await generateVisual(
            { topic, hint: body.hint, pdfExcerpt: body.pdfExcerpt },
            { apiKey },
          );
          if (result.warnings.length > 0) {
            console.warn("illustrate retries", result.warnings);
          }
          return new Response(
            JSON.stringify({ ok: true, visual: result.visual, attempts: result.attempts }),
            { status: 200, headers: corsHeaders },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error("illustrate error", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },
    },
  },
});
