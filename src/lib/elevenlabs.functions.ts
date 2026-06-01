import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  ensureScholarAgentId,
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

/**
 * Look up (or create) the auto-provisioned Scholar agent on the configured
 * ElevenLabs workspace and return both the agent ID and a fresh signed URL
 * for a WebSocket session. This is what the UI calls when the user clicks
 * "Start" — no manual agent setup required.
 */
export const startScholarVoiceSession = createServerFn({ method: "POST" }).handler(async () => {
  const agentId = await ensureScholarAgentId();
  const signedUrl = await fetchElevenLabsConversationSignedUrl(agentId);
  return { agentId, signedUrl };
});
