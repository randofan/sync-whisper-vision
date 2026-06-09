import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";

const corsHeaders = {
  "Content-Type": "application/json",
};

function buildSystemPrompt(pdfTitle: string, pdfText: string) {
  return `You are "Scholar", a peer-level technical research companion. The user has uploaded a paper titled "${pdfTitle}". Use it as the PRIMARY source of truth.

You have THREE client tools that run on the user's device. Use them deliberately — they return immediately and the result is delivered to you a few seconds later as a contextual update.

1. visualize({topic, hint?}) — generate a concrete chart, math derivation, diagram, or table on the user's canvas. Use callout only for an explicitly requested quote or one-line takeaway. The hint must name the visual type plus concrete contents, not prompt prose like "a table summarizing...". The tool returns instantly with "queued"; keep talking. When the visual is ready you'll receive a contextual update — briefly reference what's now on screen.
2. research({query, scope?}) — fire ONE focused web search + citation lookup for related work or external context. Use at most once per user turn when the answer is outside the paper. Returns instantly; results stream in as a contextual update.
3. deep_think({question}) — for heavy reasoning, math derivations, or proofs that need careful work. Use when the user asks "why" or "derive" or for non-trivial multi-step reasoning over the paper.

CRITICAL behavior:
- Speak naturally and continuously. Never say "let me look that up" and pause — fire the tool and KEEP TALKING about what you already know while it runs.
- When a contextual update arrives ("[VISUAL READY: ...]" or "[RESEARCH: ...]" or "[DEEP_THINK: ...]"), seamlessly weave it into your current sentence: "...and as you can see on the canvas now, ..." or "actually I just found that ...".
- Be concise (researcher peer-level, not lecturer). Short sentences, technical vocabulary OK.
- Do NOT read formulas verbatim — fire visualize() and describe them.

PAPER CONTENT:
"""
${pdfText}
"""`;
}

interface TokenRequestBody {
  agentId?: string;
  pdfTitle?: string;
  pdfText?: string;
  firstMessage?: string;
}

export const Route = createFileRoute("/api/elevenlabs-token")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const body = (await request.json()) as TokenRequestBody;
        const agentId = body.agentId?.trim();
        if (!agentId) {
          return new Response(JSON.stringify({ error: "agentId required" }), {
            status: 400,
            headers: corsHeaders,
          });
        }
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "ELEVENLABS_API_KEY not configured" }),
            { status: 500, headers: corsHeaders },
          );
        }

        const res = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
          { headers: { "xi-api-key": apiKey } },
        );
        if (!res.ok) {
          const txt = await res.text();
          return new Response(
            JSON.stringify({ error: `ElevenLabs token error: ${res.status} ${txt}` }),
            { status: 502, headers: corsHeaders },
          );
        }
        const data = (await res.json()) as { token?: string };
        const systemPrompt =
          body.pdfText && body.pdfTitle
            ? buildSystemPrompt(body.pdfTitle, body.pdfText)
            : undefined;

        return new Response(
          JSON.stringify({
            token: data.token,
            systemPrompt,
            firstMessage:
              body.firstMessage ??
              (body.pdfTitle
                ? `I've read "${body.pdfTitle}". What would you like to dig into first?`
                : "Hi — upload a paper and I'll dig in with you."),
          }),
          { status: 200, headers: corsHeaders },
        );
      },
    },
  },
});
