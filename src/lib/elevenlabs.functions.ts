import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getElevenLabsConversationToken = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      agentId: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY_1;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY_1 is not configured");
    }

    const url = `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(
      data.agentId,
    )}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { "xi-api-key": apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `ElevenLabs token request failed [${res.status}]: ${body.slice(0, 500)}`,
      );
    }

    const json = (await res.json()) as { token?: string };
    if (!json.token) {
      throw new Error("ElevenLabs returned no token");
    }
    return { token: json.token };
  });
