import { describe, expect, it } from "vitest";
import { generateResearch } from "./research.server";

const apiKey = process.env.LOVABLE_API_KEY ?? "";
const runIf = apiKey ? describe : describe.skip;

runIf("research live generation", () => {
  it(
    "produces a valid research result for a real paper topic",
    async () => {
      const { result, attempts, warnings } = await generateResearch(
        {
          query:
            "Background and prior work on lossless weight compression for LLM inference",
          pdfExcerpt:
            "Unweight: Lossless MLP Weight Compression for LLM Inference. We present a composable GPU toolkit for dense inference and MoE serving, focused on lossless compression of weight tensors via bit-level decomposition (sign, exponent, mantissa for BF16).",
        },
        { apiKey, maxAttempts: 4 },
      );
      expect(result.summary.length).toBeGreaterThan(20);
      // citations may be empty (it's correct to omit unverifiable URLs) but must be an array.
      expect(Array.isArray(result.citations)).toBe(true);
      for (const c of result.citations) {
        expect(c.url).toMatch(/^https?:\/\//);
        expect(c.title.length).toBeGreaterThan(0);
      }
      console.log("research attempts:", attempts, "warnings:", warnings);
      console.log("research summary:", result.summary);
      console.log("research citations:", result.citations.length);
    },
    180_000,
  );

  it(
    "handles a vague topic without throwing",
    async () => {
      const { result } = await generateResearch(
        { query: "key concepts in unweight 2026" },
        { apiKey, maxAttempts: 4 },
      );
      expect(result.summary.length).toBeGreaterThan(10);
    },
    180_000,
  );
});
