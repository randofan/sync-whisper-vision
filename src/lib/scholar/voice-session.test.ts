import { describe, expect, it } from "vitest";
import { buildScholarPrompt, buildScholarVoiceSessionOptions } from "./voice-session";

describe("Scholar voice session options", () => {
  it("uses authenticated WebSocket sessions with signed URLs", () => {
    const options = buildScholarVoiceSessionOptions("wss://api.elevenlabs.io/v1/convai/conversation?signed=1", null);

    expect(options).toMatchObject({
      signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?signed=1",
      connectionType: "websocket",
    });
    expect(options).not.toHaveProperty("conversationToken");
  });

  it("includes bounded PDF context in agent overrides", () => {
    const prompt = buildScholarPrompt({ name: "paper.pdf", pages: 7, text: "x".repeat(31_000) });

    expect(prompt).toContain('The user uploaded the PDF "paper.pdf" (7 pages)');
    expect(prompt).toContain("PAPER CONTENT");
    expect(prompt.length).toBeLessThan(31_000);
  });
});