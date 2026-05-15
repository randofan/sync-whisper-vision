import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

const corsHeaders = { "Content-Type": "application/json" };

const ChartSpec = z.object({
  chartType: z.enum(["line", "bar", "area", "scatter"]),
  xKey: z.string(),
  yKeys: z.array(z.string()).min(1),
  data: z.array(z.record(z.string(), z.union([z.number(), z.string()]))).min(2),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});
const MathSpec = z.object({
  steps: z.array(z.string()).min(1),
  inline: z.string().optional(),
});
const DiagramSpec = z.object({ mermaid: z.string().min(5) });
const TableSpec = z.object({
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).min(1),
});
const CalloutSpec = z.object({
  body: z.string(),
  tone: z.enum(["info", "warn", "key"]).optional(),
});

const VisualSchema = z.object({
  title: z.string(),
  narration: z.string().describe("One short sentence summarizing what's on screen"),
  kind: z.enum(["chart", "math", "diagram", "table", "callout"]),
  chart: ChartSpec.optional(),
  math: MathSpec.optional(),
  diagram: DiagramSpec.optional(),
  table: TableSpec.optional(),
  callout: CalloutSpec.optional(),
});

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
          const gateway = createLovableAiGatewayProvider(apiKey);
          const model = gateway("google/gemini-3-flash-preview");
          const { experimental_output: out } = await generateText({
            model,
            experimental_output: Output.object({ schema: VisualSchema }),
            system: `You are a scientific visualization generator. Given a topic from a research paper, choose the BEST visualization kind and return a complete spec.

Rules:
- "chart": pick when data/trends/comparisons are involved. Always include realistic illustrative data points (8-15) inferred from the paper context.
- "math": for formulas/derivations. Each step is a KaTeX string (no $ delimiters).
- "diagram": for processes/architectures/flows. Use valid mermaid syntax (graph TD or flowchart LR or sequenceDiagram).
- "table": for comparisons/parameters.
- "callout": only as last resort for pure conceptual notes.

Return only the chosen kind's spec field; leave others undefined.`,
            prompt: `Topic: ${topic}
${body.hint ? `Hint: ${body.hint}\n` : ""}${body.pdfExcerpt ? `Paper context (excerpt):\n${body.pdfExcerpt.slice(0, 8000)}` : ""}`,
          });

          return new Response(JSON.stringify({ ok: true, visual: out }), {
            status: 200,
            headers: corsHeaders,
          });
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
