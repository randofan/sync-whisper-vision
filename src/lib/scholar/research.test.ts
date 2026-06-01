import { describe, expect, it, vi } from "vitest";
import { generateResearch, normalizeResearch } from "./research.server";

describe("normalizeResearch", () => {
  it("rejects missing summary", () => {
    const res = normalizeResearch({ keyPoints: [] });
    expect(res.ok).toBe(false);
  });

  it("coerces a string keyPoints into an array", () => {
    const res = normalizeResearch({
      summary: "Test summary about a topic.",
      keyPoints: "single point",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.keyPoints).toEqual(["single point"]);
  });

  it("treats null keyPoints as empty array", () => {
    const res = normalizeResearch({
      summary: "x",
      keyPoints: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.keyPoints).toEqual([]);
  });

  it("trims and dedupes empty bullets", () => {
    const res = normalizeResearch({
      summary: "fine",
      keyPoints: ["a", "  ", "b"],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.keyPoints).toEqual(["a", "b"]);
  });

  it("rejects when loose schema doesn't match", () => {
    const res = normalizeResearch("not an object");
    expect(res.ok).toBe(false);
  });
});

describe("generateResearch fallback behavior", () => {
  it("returns a paper-grounded fallback instead of surfacing Payment Required", async () => {
    const generateTextImpl = vi.fn().mockRejectedValue(new Error("Payment Required"));

    const result = await generateResearch(
      {
        query: "related work for lossless BF16 compression",
        pdfExcerpt: "Unweight separates BF16 values into sign, exponent, and mantissa fields.",
      },
      { apiKey: "test-key", maxAttempts: 3, generateTextImpl },
    );

    expect(generateTextImpl).toHaveBeenCalledTimes(1);
    expect(result.result.summary).toContain("uploaded paper excerpt");
    expect(result.warnings.join("\n")).not.toMatch(/Payment Required/);
  });
});
