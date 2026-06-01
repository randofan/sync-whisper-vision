import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetScholarAgentCache,
  ensureScholarAgentId,
} from "./elevenlabs.server";
import { SCHOLAR_AGENT_NAME } from "./scholar/scholar-agent-config";

const ORIGINAL_KEY = process.env.ELEVENLABS_API_KEY_1;

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY_1 = "test-key";
  __resetScholarAgentCache();
});

afterEach(() => {
  process.env.ELEVENLABS_API_KEY_1 = ORIGINAL_KEY;
  vi.restoreAllMocks();
});

describe("ensureScholarAgentId", () => {
  it("reuses an existing auto-provisioned agent when one matches by name", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agents: [{ agent_id: "agent_existing", name: SCHOLAR_AGENT_NAME }],
          }),
          { status: 200 },
        ),
      );

    await expect(ensureScholarAgentId()).resolves.toBe("agent_existing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/v1/convai/agents?");

    // Cached: a second call must not hit the network.
    await expect(ensureScholarAgentId()).resolves.toBe("agent_existing");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a new agent (with our client tools) when none exist", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ agents: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ agent_id: "agent_new" }), { status: 200 }),
      );

    await expect(ensureScholarAgentId()).resolves.toBe("agent_new");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toContain("/v1/convai/agents/create");
    const body = JSON.parse((createInit as RequestInit).body as string);
    expect(body.name).toBe(SCHOLAR_AGENT_NAME);
    const toolNames = body.conversation_config.agent.prompt.tools.map(
      (t: { name: string }) => t.name,
    );
    expect(toolNames).toEqual(["visualize", "research", "deep_think"]);
    // Overrides must be whitelisted so session-time prompt/firstMessage
    // overrides actually take effect.
    expect(
      body.platform_settings.overrides.conversation_config_override.agent.prompt.prompt,
    ).toBe(true);
    expect(
      body.platform_settings.overrides.conversation_config_override.agent.first_message,
    ).toBe(true);
  });

  it("surfaces a useful error when the ElevenLabs API rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("unauthorized", { status: 401 }),
    );

    await expect(ensureScholarAgentId()).rejects.toThrow(
      /list agents request failed \[401\]: unauthorized/,
    );
  });
});
