import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  fetchElevenLabsConversationSignedUrl,
  fetchElevenLabsConversationToken,
} from "./elevenlabs.server";

const AgentIdSchema = z.object({
  agentId: z.string().trim().min(1).max(200),
});

export const getElevenLabsConversationToken = createServerFn({ method: "POST" })
  .inputValidator((input) => AgentIdSchema.parse(input))
  .handler(async ({ data }) => {
    return { token: await fetchElevenLabsConversationToken(data.agentId) };
  });

export const getElevenLabsConversationSignedUrl = createServerFn({ method: "POST" })
  .inputValidator((input) => AgentIdSchema.parse(input))
  .handler(async ({ data }) => {
    return { signedUrl: await fetchElevenLabsConversationSignedUrl(data.agentId) };
  });
