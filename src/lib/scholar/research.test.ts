import { describe, expect, it } from "vitest";
import { normalizeResearch, mergeCitations } from "./research.server";

describe("normalizeResearch", () => {
  it("rejects missing summary", () => {
    const res = normalizeResearch({ keyPoints: [], citations: [] });
    expect(res.ok).toBe(false);
  });

  it("coerces a string keyPoints into an array", () => {
    const res = normalizeResearch({
      summary: "Test summary about a topic.",
      keyPoints: "single point",
      citations: [],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.keyPoints).toEqual(["single point"]);
  });

  it("drops citations with invalid or missing URLs", () => {
    const res = normalizeResearch({
      summary: "x",
      keyPoints: [],
      citations: [
        { title: "Good", url: "https://arxiv.org/abs/1234" },
        { title: "Bad", url: "not-a-url" },
        { title: "Also bad", url: null },
        { title: null, url: "https://example.com" },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.citations).toHaveLength(1);
      expect(res.result.citations[0].url).toBe("https://arxiv.org/abs/1234");
    }
  });

  it("treats null citations/keyPoints as empty", () => {
    const res = normalizeResearch({
      summary: "x",
      keyPoints: null,
      citations: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.citations).toEqual([]);
      expect(res.result.keyPoints).toEqual([]);
    }
  });

  it("rejects when loose schema doesn't match", () => {
    const res = normalizeResearch("not an object");
    expect(res.ok).toBe(false);
  });
});

describe("mergeCitations", () => {
  it("dedupes by URL and caps at 8", () => {
    const primary = [{ title: "a", url: "https://a.com" }];
    const extra = [
      { title: "a-dup", url: "https://a.com" },
      { title: "b", url: "https://b.com" },
    ];
    const merged = mergeCitations(primary, extra);
    expect(merged).toHaveLength(2);
    expect(merged.map((c) => c.url)).toEqual(["https://a.com", "https://b.com"]);
  });
});
