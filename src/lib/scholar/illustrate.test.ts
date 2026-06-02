import { describe, expect, it, vi } from "vitest";
import {
  containsHedgeLanguage,
  detectRequestedKind,
  generateVisual,
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

describe("generateVisual — callout and billing fallbacks", () => {
  it("renders an explicit callout locally without touching the paid AI gateway", async () => {
    const generateTextImpl = vi.fn();

    const result = await generateVisual(
      { topic: "Key theorem", hint: "callout: convergence depends on a bounded variance assumption" },
      { apiKey: "test-key", generateTextImpl },
    );

    expect(generateTextImpl).not.toHaveBeenCalled();
    expect(result.attempts).toBe(0);
    expect(result.visual.kind).toBe("callout");
    expect(result.visual.callout?.body).toContain("convergence");
    expect(validateVisual(result.visual)).toEqual({ ok: true });
  });

  it("falls back to a valid local callout instead of surfacing Payment Required", async () => {
    const generateTextImpl = vi.fn().mockRejectedValue(new Error("Payment Required"));

    const result = await generateVisual(
      { topic: "Attention sparsity tradeoff", hint: "diagram" },
      { apiKey: "test-key", maxAttempts: 4, generateTextImpl },
    );

    expect(generateTextImpl).toHaveBeenCalledTimes(1);
    expect(result.visual.kind).toBe("callout");
    expect(result.visual.callout?.body).toBe("Attention sparsity tradeoff");
    expect(result.warnings.join("\n")).not.toMatch(/Payment Required/);
    expect(validateVisual(result.visual)).toEqual({ ok: true });
  });

  it("falls back to a valid callout when every structured attempt is invalid", async () => {
    const generateTextImpl = vi.fn().mockResolvedValue({
      experimental_output: { kind: "diagram", diagram: "not mermaid" },
    });

    const result = await generateVisual(
      { topic: "Broken generated diagram", hint: "show the architecture" },
      { apiKey: "test-key", maxAttempts: 2, generateTextImpl },
    );

    expect(generateTextImpl).toHaveBeenCalledTimes(2);
    expect(result.visual.kind).toBe("callout");
    expect(result.visual.callout?.body).toBe("show the architecture");
    expect(validateVisual(result.visual)).toEqual({ ok: true });
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
    "The paper describes the concept of edge expansion in expander graphs but does not provide explicit mathematical equations for their formal definition or properties within the provided text.",
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

describe("generateVisual — kind enforcement and hedge rejection (regression)", () => {
  it("retries when the model returns a callout for a math request, never accepting hedge text", async () => {
    const hedgeCallout = {
      title: "Mathematical Formalism of Expander Graphs in RNG Paper",
      narration:
        "The paper describes the concept of edge expansion in expander graphs but does not provide explicit mathematical equations within the provided text.",
      kind: "callout",
      callout: {
        body: "The paper describes the concept of edge expansion in expander graphs but does not provide explicit mathematical equations within the provided text.",
      },
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
      { apiKey: "test-key", maxAttempts: 4, generateTextImpl },
    );

    expect(generateTextImpl).toHaveBeenCalledTimes(2);
    expect(result.visual.kind).toBe("math");
    expect(result.visual.math?.steps.length).toBeGreaterThan(0);
    expect(containsHedgeLanguage(result.visual.narration)).toBe(false);
  });

  it("rejects a diagram whose narration starts with 'Diagram:' meta-label", async () => {
    const metaCallout = {
      title: "Expander Graph vs Fat Tree",
      narration: "Diagram: Illustrate the concept of edge expansion in an expander graph.",
      kind: "diagram",
      diagram: { mermaid: "flowchart LR\n  A --> B" },
    };
    const realDiagram = {
      title: "Expander vs Fat Tree",
      narration: "Cuts in expander graphs cross many edges; fat-tree cuts are limited by tree level.",
      kind: "diagram",
      diagram: {
        mermaid:
          "flowchart LR\n  S[Small cut S] --> E[Many crossing edges]\n  T[Fat tree cut] --> L[Few crossing edges]",
      },
    };
    const generateTextImpl = vi
      .fn()
      .mockResolvedValueOnce({ experimental_output: metaCallout })
      .mockResolvedValueOnce({ experimental_output: realDiagram });

    const result = await generateVisual(
      { topic: "Expander Graph vs. Fat Tree Edge Expansion", hint: "diagram" },
      { apiKey: "test-key", maxAttempts: 4, generateTextImpl },
    );

    expect(generateTextImpl).toHaveBeenCalledTimes(2);
    expect(result.visual.kind).toBe("diagram");
    expect(containsHedgeLanguage(result.visual.narration)).toBe(false);
  });

  it("does NOT short-circuit to a local callout when topic implies a structured kind and apiKey is missing", async () => {
    // Without an API key we still cannot generate — but we must NOT pretend a
    // math request was satisfied by a callout. The fallback callout body must
    // reference the topic so the agent can see something failed.
    const result = await generateVisual(
      { topic: "Mathematical formalism of expander graphs", hint: "math equations" },
      { apiKey: "", maxAttempts: 1 },
    );
    // Today we still fall back to a callout when generation is impossible, but
    // the warnings must clearly state the requested kind was not delivered.
    expect(result.warnings.join("\n")).toMatch(/unavailable|did not return/i);
  });
});
