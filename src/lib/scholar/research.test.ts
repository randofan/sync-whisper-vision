import { describe, expect, it } from "vitest";
import { normalizeResearch } from "./research.server";

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
