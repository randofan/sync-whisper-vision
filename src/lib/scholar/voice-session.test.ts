import { describe, expect, it } from "vitest";
import {
  buildScholarContextUpdate,
  buildScholarPrompt,
  buildScholarVoiceSessionOptions,
} from "./voice-session";

describe("Scholar voice session options", () => {
  it("uses authenticated WebSocket sessions with signed URLs", () => {
    const options = buildScholarVoiceSessionOptions("wss://api.elevenlabs.io/v1/convai/conversation?signed=1");

    expect(options).toMatchObject({
      signedUrl: "wss://api.elevenlabs.io/v1/convai/conversation?signed=1",
      connectionType: "websocket",
    });
    expect(options).not.toHaveProperty("conversationToken");
    expect(options).not.toHaveProperty("overrides");
  });

  it("includes bounded PDF context in agent overrides", () => {
    const prompt = buildScholarPrompt({ name: "paper.pdf", pages: 7, text: "x".repeat(31_000) });

    expect(prompt).toContain('The user uploaded the PDF "paper.pdf" (7 pages)');
    expect(prompt).toContain("PAPER CONTENT");
    expect(prompt.length).toBeLessThan(31_000);
  });

  it("builds PDF context as a contextual update instead of rejected agent overrides", () => {
    const context = buildScholarContextUpdate({ name: "paper.pdf", pages: 2, text: "TEST_CONTEXT_ABC" });

    expect(context).toContain("session instructions and uploaded PDF context");
    expect(context).toContain('The user uploaded the PDF "paper.pdf" (2 pages)');
    expect(context).toContain("TEST_CONTEXT_ABC");
  });
});