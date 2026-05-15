import { describe, expect, it } from "vitest";
import { fetchElevenLabsConversationSignedUrl } from "./elevenlabs.server";

const AGENT_ID = "agent_1701krmxt8bve3svarx3wz0kj1wj";

async function openConversationMetadata(signedUrl: string) {
  const separator = signedUrl.includes("?") ? "&" : "?";
  const socket = new WebSocket(`${signedUrl}${separator}source=lovable_test&version=1.0.0`, ["convai"]);

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out waiting for ElevenLabs conversation metadata"));
    }, 15_000);

    socket.addEventListener(
      "open",
      () => {
        socket.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
      },
      { once: true },
    );
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timeout);
        socket.close(1000, "live test complete");
        resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("ElevenLabs signed WebSocket connection failed"));
      },
      { once: true },
    );
    socket.addEventListener(
      "close",
      (event) => {
        if (event.code !== 1000) {
          clearTimeout(timeout);
          reject(new Error(`ElevenLabs signed WebSocket closed early [${event.code}]: ${event.reason}`));
        }
      },
      { once: true },
    );
  });
}

describe("ElevenLabs live connector", () => {
  it.skipIf(!process.env.ELEVENLABS_API_KEY_1 && !process.env.ELEVENLABS_API_KEY)(
    "opens an authenticated signed WebSocket conversation",
    async () => {
      const signedUrl = await fetchElevenLabsConversationSignedUrl(AGENT_ID);
      const message = await openConversationMetadata(signedUrl);

      expect(message.type).toBe("conversation_initiation_metadata");
      expect(message.conversation_initiation_metadata_event).toMatchObject({
        conversation_id: expect.stringMatching(/^conv_/),
      });
    },
    20_000,
  );
});