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

describe("generateResearch failure surfacing", () => {
  it("throws a visible Payment Required error instead of fabricating a stub briefing", async () => {
    const generateContentImpl = vi.fn().mockRejectedValue(new Error("Payment Required"));

    await expect(
      generateResearch(
        {
          query: "related work for lossless BF16 compression",
          pdfExcerpt: "Unweight separates BF16 values into sign, exponent, and mantissa fields.",
        },
        { apiKey: "test-key", maxAttempts: 3, generateContentImpl },
      ),
    ).rejects.toThrow(/credits exhausted|unpaid|quota/i);
    expect(generateContentImpl).toHaveBeenCalledTimes(1);
  });

  it("throws when no AI provider is configured", async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      await expect(
        generateResearch({ query: "anything" }, { maxAttempts: 1 }),
      ).rejects.toThrow(/No AI provider configured/);
    } finally {
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });
});
