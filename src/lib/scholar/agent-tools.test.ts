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
});