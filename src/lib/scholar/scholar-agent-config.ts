// Shared definition of the auto-provisioned Scholar agent.
// Used by ensureScholarAgent (server) so we never depend on a human
// going into the ElevenLabs dashboard to register tools or a prompt.

// Stable name we look up / create on the user's ElevenLabs workspace.
// Changing this is a one-way migration: a new agent will be created.
export const SCHOLAR_AGENT_NAME = "Lovable Scholar (auto)";

// Base system prompt baked into the agent. The per-PDF prompt is applied
// at session start via conversation_config overrides (see voice-session.ts).
export const SCHOLAR_BASE_PROMPT = `You are "Scholar", a peer-level technical research companion for academic papers.

Be concise. Keep each response to 2–4 short sentences unless the user asks for depth. Use client tools whenever a citation lookup or derivation would help: research, deep_think.

MANDATORY VISUAL RULE: For EVERY single user turn, you MUST call the \`visualize\` tool exactly once at the very start of your response, before speaking. Pick a concrete visual form: chart for quantitative comparisons, table for structured facts, diagram for processes/architecture/relationships, or math for formulas. Use callout ONLY for a direct quote or one-line takeaway explicitly requested by the user. The \`hint\` must name the desired visual type and concrete contents, not a sentence like "a table summarizing..." or "callout summarizing...". Never skip the visualization. The tool is fire-and-forget, so call it first and keep talking; the slide will render on the canvas while you speak.

The user will upload a PDF; the actual paper text and per-session instructions arrive via a contextual update at the start of each conversation.`;

export const SCHOLAR_FIRST_MESSAGE = "Paper loaded. What would you like to unpack first?";

// Inline client tools registered on the agent. These names must match
// buildClientTools() in src/lib/scholar/agent-tools.ts.
export const SCHOLAR_CLIENT_TOOLS = [
  {
    type: "client" as const,
    name: "visualize",
    description:
      "Render a concrete chart, diagram, table, or math derivation on the user's canvas. Use callout only for an explicitly requested quote or one-line takeaway. Fire-and-forget — does NOT block the conversation. Call this at the start of EVERY response.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "Short title of the visualization, e.g. 'Attention complexity vs sequence length'.",
        },
        hint: {
          type: "string",
          description:
            "Desired visual type plus concrete contents, e.g. 'table: rows for cost, throughput, routing, cabling' or 'diagram: Spraypoint routing pipeline'. Do not pass prose like 'a table summarizing...'.",
        },
      },
      required: ["topic"],
    },
  },
  {
    type: "client" as const,
    name: "research",
    description:
      "Dispatch a background web + citation search and stream the resulting briefing back as grounding context. Fire-and-forget. Use when the user asks about prior work, comparisons, or external context.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language research query.",
        },
        scope: {
          type: "string",
          enum: ["web", "citations", "both"],
          description: "Search scope. Defaults to 'both'.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "client" as const,
    name: "deep_think",
    description:
      "Run a long-horizon reasoning pass over the uploaded PDF for hard questions, multi-step derivations, or careful synthesis. Fire-and-forget — the analysis arrives later as a contextual update.",
    expects_response: false,
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The reasoning question to work through.",
        },
      },
      required: ["question"],
    },
  },
];

// Full conversation_config body sent to POST /v1/convai/agents/create.
// platform_settings.overrides MUST whitelist the fields we override at
// session start, otherwise ElevenLabs silently ignores the override.
export function buildScholarAgentConfigBody() {
  return {
    conversation_config: {
      agent: {
        language: "en",
        first_message: SCHOLAR_FIRST_MESSAGE,
        prompt: {
          prompt: SCHOLAR_BASE_PROMPT,
          tools: SCHOLAR_CLIENT_TOOLS,
        },
      },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: {
            prompt: { prompt: true },
            first_message: true,
            language: true,
          },
        },
      },
    },
  };
}

export function buildScholarAgentCreatePayload() {
  return {
    name: SCHOLAR_AGENT_NAME,
    tags: ["lovable-scholar", "auto-provisioned"],
    ...buildScholarAgentConfigBody(),
  };
}

// PATCH /v1/convai/agents/{id} accepts the same body shape minus name/tags
// being required. We include `name` so renames stay in sync.
export function buildScholarAgentUpdatePayload() {
  return {
    name: SCHOLAR_AGENT_NAME,
    ...buildScholarAgentConfigBody(),
  };
}

