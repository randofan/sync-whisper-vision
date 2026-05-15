import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

const corsHeaders = { "Content-Type": "application/json" };

const ResearchSchema = z.object({
  summary: z.string().describe("2-4 sentence synthesis of findings"),
  keyPoints: z.array(z.string()).max(5).default([]),
  citations: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        snippet: z.string().optional(),
      }),
    )
    .max(8)
    .default([]),
});

interface ReqBody {
  query?: string;
  pdfExcerpt?: string;
  scope?: "web" | "citations" | "both";
}

async function searchArxiv(query: string) {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent("all:" + query)}&max_results=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const xml = await res.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    return entries.slice(0, 5).map((e) => {
      const block = e[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const link = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() ?? "";
      const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);
      return { title, url: link, snippet: summary };
    });
  } catch {
    return [];
  }
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
          // Gather arXiv hits in parallel with synthesis prep
          const arxivPromise = searchArxiv(query);

          const gateway = createLovableAiGatewayProvider(apiKey);
          // Use Gemini with built-in Google Search grounding via a strong model.
          const model = gateway("google/gemini-2.5-flash");

          // First: grounded synthesis using the model itself (Gemini has training-time + web knowledge).
          // We ask the model to act as a research librarian and produce both a summary AND candidate citations.
          const { experimental_output: out } = await generateText({
            model,
            experimental_output: Output.object({ schema: ResearchSchema }),
            system: `You are a research librarian. Synthesize what's known about a topic, citing real, verifiable URLs (prefer arxiv.org, doi.org, official project pages, well-known journals or .edu domains). NEVER fabricate URLs — if unsure, omit the citation. Be concise and technical.`,
            prompt: `Research query: ${query}
${body.pdfExcerpt ? `\nContext from the paper the user is reading:\n${body.pdfExcerpt.slice(0, 4000)}` : ""}

Provide a tight summary, 3-5 key points, and up to 5 citations.`,
          });

          const arxiv = await arxivPromise;
          // Merge arxiv hits, avoiding duplicates by URL.
          const seen = new Set(out.citations.map((c) => c.url));
          for (const a of arxiv) {
            if (!seen.has(a.url) && out.citations.length < 8) {
              out.citations.push(a);
              seen.add(a.url);
            }
          }

          return new Response(JSON.stringify({ ok: true, ...out }), {
            status: 200,
            headers: corsHeaders,
          });
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
