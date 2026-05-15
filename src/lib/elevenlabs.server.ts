const ELEVENLABS_API_ORIGIN = "https://api.elevenlabs.io";

function getElevenLabsApiKey() {
  const apiKey = process.env.ELEVENLABS_API_KEY_1 ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ElevenLabs connector API key is not configured");
  }
  return apiKey;
}

async function fetchElevenLabsJson<T>(path: string, label: string): Promise<T> {
  const res = await fetch(`${ELEVENLABS_API_ORIGIN}${path}`, {
    method: "GET",
    headers: { "xi-api-key": getElevenLabsApiKey() },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${label} request failed [${res.status}]: ${body.slice(0, 500)}`);
  }

  return (await res.json()) as T;
}

export async function fetchElevenLabsConversationToken(agentId: string) {
  const json = await fetchElevenLabsJson<{ token?: string }>(
    `/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
    "token",
  );
  if (!json.token) {
    throw new Error("ElevenLabs returned no conversation token");
  }
  return json.token;
}

export async function fetchElevenLabsConversationSignedUrl(agentId: string) {
  const json = await fetchElevenLabsJson<{ signed_url?: string }>(
    `/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    "signed URL",
  );
  if (!json.signed_url) {
    throw new Error("ElevenLabs returned no signed URL");
  }
  return json.signed_url;
}