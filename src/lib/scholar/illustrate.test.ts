import { describe, expect, it, vi } from "vitest";
import {
  containsHedgeLanguage,
  createFallbackVisual,
  detectRequestedKind,
  generateVisual,
  isPromptLikeVisualText,
  normalizeLoose,
  validateMermaid,
  validateVisual,
  type Visual,
} from "./illustrate.server";

describe("validateMermaid", () => {
  it("accepts a well-formed flowchart", () => {
    const src = `flowchart TD\n  A[Start] --> B[End]`;
    expect(validateMermaid(src)).toEqual({ ok: true });
  });
  it("accepts sequenceDiagram", () => {
    const src = `sequenceDiagram\n  Alice->>Bob: hello`;
    expect(validateMermaid(src)).toEqual({ ok: true });
  });
  it("rejects missing header", () => {
    const res = validateMermaid(`A --> B\nB --> C`);
    expect(res.ok).toBe(false);
  });
  it("rejects unbalanced brackets", () => {
    const res = validateMermaid(`graph TD\n  A[Start --> B[End]`);
    expect(res.ok).toBe(false);
  });
  it("rejects too few lines", () => {
    const res = validateMermaid(`graph TD`);
    expect(res.ok).toBe(false);
  });
});

describe("validateVisual", () => {
  it("rejects when kind/spec mismatch", () => {
    const v = { title: "x", narration: "y", kind: "diagram" } as Visual;
    const res = validateVisual(v);
    expect(res.ok).toBe(false);
  });
  it("accepts a complete diagram visual", () => {
    const v: Visual = {
      title: "x",
      narration: "y",
      kind: "diagram",
      diagram: { mermaid: "flowchart LR\n  A --> B" },
    };
    expect(validateVisual(v)).toEqual({ ok: true });
  });
});

describe("normalizeLoose — callout robustness (regression)", () => {
  const fallback = { title: "Topic", narration: "Narration sentence" };

  it("synthesizes a callout from narration when the callout field is missing", () => {
    // Real-world failure: model returned kind=callout but no callout field.
    const res = normalizeLoose({ kind: "callout" } as never, fallback);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visual.callout).toEqual({ body: "Narration sentence" });
  });

  it("synthesizes a callout from narration when callout is explicitly null", () => {
    const res = normalizeLoose({ kind: "callout", callout: null } as never, fallback);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visual.callout?.body).toBe("Narration sentence");
  });

  it("falls back to title when narration is also missing", () => {
    const res = normalizeLoose(
      { kind: "callout" } as never,
      { title: "Just a title", narration: "" },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visual.callout?.body).toBe("Just a title");
  });

  it("accepts callout as a bare string", () => {
    const res = normalizeLoose(
      { kind: "callout", callout: "hello world" } as never,
      fallback,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visual.callout).toEqual({ body: "hello world" });
  });

  it.each(["text", "message", "content", "note"])(
    "remaps misnamed body field '%s' onto callout.body",
    (key) => {
      const res = normalizeLoose(
        { kind: "callout", callout: { [key]: "remapped" } } as never,
        fallback,
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.visual.callout?.body).toBe("remapped");
    },
  );

  it("preserves a valid tone", () => {
    const res = normalizeLoose(
      { kind: "callout", callout: { body: "ok", tone: "warn" } } as never,
      fallback,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visual.callout).toEqual({ body: "ok", tone: "warn" });
  });

  it("drops invalid tone values rather than failing", () => {
    const res = normalizeLoose(
      { kind: "callout", callout: { body: "ok", tone: "bogus" } } as never,
      fallback,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.visual.callout?.tone).toBeUndefined();
  });

  it("still fails (loudly) when a non-callout kind is missing its spec", () => {
    // We only soften callouts — other kinds genuinely need their spec.
    const res = normalizeLoose({ kind: "chart" } as never, fallback);
    expect(res.ok).toBe(false);
  });

  it("normalized callout passes validateVisual", () => {
    const res = normalizeLoose({ kind: "callout" } as never, fallback);
    expect(res.ok).toBe(true);
    if (res.ok) expect(validateVisual(res.visual)).toEqual({ ok: true });
  });
});

describe("generateVisual — surfaces billing failures visibly (no silent fallback)", () => {
  it("renders an explicit callout locally without touching the paid AI gateway", async () => {
    const generateTextImpl = vi.fn();

    const result = await generateVisual(
      { topic: "Key theorem", hint: "callout: convergence depends on a bounded variance assumption" },
      { env: { lovableApiKey: "test-key" }, generateTextImpl },
    );

    expect(generateTextImpl).not.toHaveBeenCalled();
    expect(result.attempts).toBe(0);
    expect(result.visual.kind).toBe("callout");
    expect(result.visual.callout?.body).toContain("convergence");
    expect(validateVisual(result.visual)).toEqual({ ok: true });
  });

  it("throws a visible Payment Required error instead of fabricating a stub", async () => {
    const generateTextImpl = vi.fn().mockRejectedValue(new Error("Payment Required"));

    await expect(
      generateVisual(
        { topic: "Attention sparsity tradeoff", hint: "diagram" },
        { env: { lovableApiKey: "test-key" }, maxAttempts: 4, generateTextImpl },
      ),
    ).rejects.toThrow(/credits exhausted|unpaid/i);
    expect(generateTextImpl).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting attempts on persistently invalid output", async () => {
    const generateTextImpl = vi.fn().mockResolvedValue({
      experimental_output: { kind: "diagram", diagram: "not mermaid" },
    });

    await expect(
      generateVisual(
        { topic: "Broken generated diagram", hint: "show the architecture" },
        { env: { lovableApiKey: "test-key" }, maxAttempts: 2, generateTextImpl },
      ),
    ).rejects.toThrow(/Failed to generate a valid visual/);
    expect(generateTextImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when no AI provider is configured at all", async () => {
    await expect(
      generateVisual(
        { topic: "Mathematical formalism of expander graphs", hint: "math equations" },
        { env: {}, maxAttempts: 1 },
      ),
    ).rejects.toThrow(/No AI provider configured/);
  });
});

describe("detectRequestedKind", () => {
  it.each([
    ["Mathematical Formalism of Expander Graphs", undefined, "math"],
    ["Edge expansion theorem", undefined, "math"],
    ["Spraypoint routing pipeline", "diagram", "diagram"],
    ["Expander graph vs fat tree topology", undefined, "diagram"],
    ["Throughput trend across scales", "chart", "chart"],
    ["Baseline comparison matrix", undefined, "table"],
    ["Key takeaway", "callout", "callout"],
    ["Generic topic with no signal", undefined, null],
  ])("detects kind for topic=%j hint=%j", (topic, hint, expected) => {
    expect(detectRequestedKind({ topic, hint })).toBe(expected);
  });
});

describe("containsHedgeLanguage", () => {
  it.each([
    "The paper does not provide explicit equations.",
    "Not enough information in the excerpt.",
    "No explicit formulas appear in the text.",
    "The text does not contain a diagram.",
    "Insufficient detail to derive the result.",
    "Diagram: Illustrate the concept of edge expansion.",
    "Chart: trend over time",
  ])("flags hedge text: %s", (s) => {
    expect(containsHedgeLanguage(s)).toBe(true);
  });

  it.each([
    "Three contributions: A, B, C with respective ablations.",
    "Edge expansion bounds the second eigenvalue of the adjacency matrix.",
    "BF16 splits into 1 sign, 8 exponent, 7 mantissa bits.",
  ])("does not flag concrete text: %s", (s) => {
    expect(containsHedgeLanguage(s)).toBe(false);
  });
});

describe("prompt-like visual text guardrails", () => {
  it.each([
    "A table comparing RNG and Fat Tree topologies based on cost, performance, and throughput.",
    "summarizing the core problem and solution presented in the paper.",
    "Callout summarizing the contribution list.",
  ])("flags prompt text rendered as a visual: %s", (s) => {
    expect(isPromptLikeVisualText(s)).toBe(true);
  });

  it("does not treat a prompt-ish callout hint as an explicit callout request", () => {
    expect(
      detectRequestedKind({
        topic: "RNG: Flat Datacenter Networks at Scale",
        hint: "Callout summarizing the core problem and solution presented in the paper.",
      }),
    ).toBeNull();
  });

  it("createFallbackVisual still builds a structured table for the RNG regression", () => {
    const visual = createFallbackVisual({
      topic: "RNG vs. Fat Tree Performance Comparison",
      hint: "A table comparing RNG and Fat Tree topologies based on cost, performance, and throughput for equivalent oversubscription ratios.",
      pdfExcerpt: "RNG topologies are 9–45% cheaper than fat trees and offer higher throughput.",
    });

    expect(visual.kind).toBe("table");
    expect(visual.table?.rows.length).toBeGreaterThanOrEqual(4);
    expect(isPromptLikeVisualText(visual.narration)).toBe(false);
    expect(validateVisual(visual)).toEqual({ ok: true });
  });
});

describe("generateVisual — kind enforcement, recentVisuals, research-triggering hints", () => {
  it("retries when the model returns a hedge callout for a math request", async () => {
    const hedgeCallout = {
      title: "Mathematical Formalism",
      narration: "The paper does not provide explicit mathematical equations within the provided text.",
      kind: "callout",
      callout: { body: "The paper does not provide explicit mathematical equations." },
    };
    const realMath = {
      title: "Edge Expansion (Math)",
      narration: "Edge expansion h(G) is the minimum boundary-to-volume ratio over small cuts.",
      kind: "math",
      math: {
        steps: [
          "h(G) = \\min_{|S| \\le |V|/2} \\frac{|E(S, \\bar S)|}{|S|}",
          "\\lambda_2(G) \\le 2 h(G)",
        ],
      },
    };
    const generateTextImpl = vi
      .fn()
      .mockResolvedValueOnce({ experimental_output: hedgeCallout })
      .mockResolvedValueOnce({ experimental_output: realMath });

    const result = await generateVisual(
      {
        topic: "Mathematical Formalism of Expander Graphs in RNG Paper",
        hint: "math equations",
        pdfExcerpt: "Edge expansion is the core property...",
      },
      { env: { lovableApiKey: "test-key" }, maxAttempts: 4, generateTextImpl },
    );

    expect(generateTextImpl).toHaveBeenCalledTimes(2);
    expect(result.visual.kind).toBe("math");
    expect(containsHedgeLanguage(result.visual.narration)).toBe(false);
  });

  it("includes recentVisuals in the prompt so the model can avoid repeats", async () => {
    const captured: Array<{ prompt: string }> = [];
    const realDiagram = {
      title: "Spraypoint routing",
      narration: "Spraypoint distributes packets across many near-edge-disjoint paths.",
      kind: "diagram",
      diagram: { mermaid: "flowchart LR\n  A[Packet] --> B[Spray paths]" },
    };
    const generateTextImpl = vi.fn(async (args: Record<string, unknown>) => {
      captured.push({ prompt: String(args.prompt) });
      return { experimental_output: realDiagram };
    });

    await generateVisual(
      {
        topic: "Spraypoint routing",
        hint: "diagram",
        recentVisuals: [
          { title: "RNG vs Fat Tree", kind: "table" },
          { title: "Edge expansion math", kind: "math" },
        ],
      },
      { env: { lovableApiKey: "test-key" }, maxAttempts: 1, generateTextImpl },
    );

    expect(captured[0].prompt).toMatch(/DO NOT repeat/);
    expect(captured[0].prompt).toMatch(/RNG vs Fat Tree/);
    expect(captured[0].prompt).toMatch(/Edge expansion math/);
  });
});
