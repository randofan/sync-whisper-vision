import { describe, expect, it, vi } from "vitest";
import { generateVisual, normalizeLoose, validateMermaid, validateVisual, type Visual } from "./illustrate.server";

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
