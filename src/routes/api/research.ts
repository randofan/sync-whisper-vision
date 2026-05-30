import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import {
  generateResearch,
  searchArxiv,
  mergeCitations,
} from "@/lib/scholar/research.server";

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
          const arxivPromise = searchArxiv(query);
          const { result, attempts, warnings } = await generateResearch(
            { query, pdfExcerpt: body.pdfExcerpt },
            { apiKey },
          );
          const arxiv = await arxivPromise;
          const citations = mergeCitations(result.citations, arxiv);

          if (warnings.length > 0) {
            console.warn("research retries", warnings);
          }

          return new Response(
            JSON.stringify({ ok: true, ...result, citations, attempts }),
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
