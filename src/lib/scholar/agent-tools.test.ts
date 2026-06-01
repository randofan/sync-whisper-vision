import { describe, expect, it, vi } from "vitest";
import {
  fetchDeepThink,
  fetchIllustration,
  fetchResearchBriefing,
  parseResearchResponse,
} from "./agent-tools";


describe("research client response handling", () => {
  it("turns the exact upstream non-JSON body into a controlled error", async () => {
    await expect(
      parseResearchResponse(
        new Response("upstream request timeout", {
          status: 502,
          statusText: "Bad Gateway",
        }),
      ),
    ).rejects.toThrow(/non-JSON response \(502 Bad Gateway\): upstream request timeout/);
  });

  it("retries transient non-JSON failures instead of crashing on Response.json", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream request timeout", { status: 502 }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          summary: "Recovered research briefing.",
          keyPoints: ["Retry succeeded"],
        }),
      );

    const result = await fetchResearchBriefing(
      { query: "unweight 2026", pdfExcerpt: "Unweight paper excerpt" },
      fetchImpl,
      { attempts: 2, retryDelayMs: 0 },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe("Recovered research briefing.");
  });

  it("returns a useful final error if every retry gets non-JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response("upstream request timeout", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    await expect(
      fetchResearchBriefing({ query: "unweight 2026" }, fetchImpl, {
        attempts: 2,
        retryDelayMs: 0,
      }),
    ).rejects.toThrow(/Research service returned a non-JSON response \(503 Service Unavailable\): upstream request timeout/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
});

describe("illustrate client response handling (callout regression)", () => {
  it("does not crash on the exact 'upstream request timeout' body that triggered the callout bug", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream request timeout", {
        status: 502,
        statusText: "Bad Gateway",
      }),
    );

    await expect(
      fetchIllustration(
        { topic: "ZipServ's Key Innovations", hint: "callout" },
        fetchImpl,
        { attempts: 1, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(
      /Illustrate service returned a non-JSON response \(502 Bad Gateway\): upstream request timeout/,
    );
  });

  it("retries transient non-JSON failures and returns the recovered visual", async () => {
    const visual = {
      title: "ZipServ's Key Innovations",
      narration: "Three pillars of the system.",
      kind: "callout" as const,
      callout: { body: "Lossless. Composable. GPU-native." },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream request timeout", { status: 502 }))
      .mockResolvedValueOnce(Response.json({ ok: true, visual }));

    const result = await fetchIllustration(
      { topic: "ZipServ's Key Innovations" },
      fetchImpl,
      { attempts: 2, retryDelayMs: 0 },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.visual?.kind).toBe("callout");
    expect(result.visual?.title).toBe("ZipServ's Key Innovations");
  });
});

describe("deep-think client response handling", () => {
  it("turns a non-JSON pdf-qa response into a controlled error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream request timeout", {
        status: 504,
        statusText: "Gateway Timeout",
      }),
    );

    await expect(
      fetchDeepThink(
        { question: "what is ZipServ?", pdfText: "x", pdfTitle: "p" },
        fetchImpl,
        { attempts: 1, retryDelayMs: 0 },
      ),
    ).rejects.toThrow(
      /Deep-think service returned a non-JSON response \(504 Gateway Timeout\): upstream request timeout/,
    );
  });
});

});