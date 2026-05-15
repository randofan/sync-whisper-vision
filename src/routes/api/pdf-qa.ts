import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

const corsHeaders = { "Content-Type": "application/json" };

interface ReqBody {
  question?: string;
  pdfText?: string;
  pdfTitle?: string;
}

export const Route = createFileRoute("/api/pdf-qa")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as ReqBody;
        const question = body.question?.trim();
        if (!question) {
          return new Response(JSON.stringify({ error: "question required" }), {
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
          const gateway = createLovableAiGatewayProvider(apiKey);
          // Heavier reasoning model for derivations / careful multi-step answers.
          const model = gateway("openai/gpt-5.4-mini");

          const { text } = await generateText({
            model,
            system: `You are a meticulous research assistant performing deep reasoning over a single paper. Cite page numbers when available (the paper text contains "--- Page N ---" markers). Use KaTeX-compatible LaTeX for math (no $ delimiters; use \\( \\) inline). Be technically rigorous but concise (3-6 short paragraphs).`,
            prompt: `Paper${body.pdfTitle ? `: "${body.pdfTitle}"` : ""}

${body.pdfText?.slice(0, 200_000) ?? "[no paper provided]"}

Question: ${question}`,
          });

          return new Response(JSON.stringify({ ok: true, answer: text }), {
            status: 200,
            headers: corsHeaders,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.error("pdf-qa error", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: corsHeaders,
          });
        }
      },
    },
  },
});
