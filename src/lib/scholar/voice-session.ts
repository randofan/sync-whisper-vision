export interface ScholarPdfContext {
  name: string;
  pages: number;
  text: string;
}

export function buildScholarPrompt(pdf: ScholarPdfContext) {
  return `You are "Scholar", a peer-level technical research companion. The user uploaded "${pdf.name}" (${pdf.pages} pages). Use the extracted paper text below as the primary source.

Be concise. Keep each response to 2–4 short sentences unless the user asks for depth. Use client tools whenever a citation lookup or derivation would help: research, deep_think.

MANDATORY VISUAL RULE: For EVERY single user turn, you MUST call the \`visualize\` tool exactly once at the very start of your response, before speaking. Pick whichever visual form best fits the answer — a chart for quantitative comparisons, a table for structured facts, a diagram for processes/architecture/relationships, a math derivation for formulas, or a callout for a key insight. Never skip the visualization, even for short or conversational answers — always find an angle worth illustrating. The tool is fire-and-forget, so call it first and keep talking; the slide will render on the canvas while you speak.

PAPER CONTENT:
"""
${pdf.text.slice(0, 30_000)}
"""`;
}

export function buildScholarContextUpdate(pdf: ScholarPdfContext) {
  return `Treat this contextual update as the session instructions and uploaded PDF context for the conversation.\n\n${buildScholarPrompt(pdf)}`;
}

export function buildScholarFirstMessage(pdf: ScholarPdfContext) {
  return `I've loaded ${pdf.name}. What would you like to unpack first?`;
}

export function buildScholarVoiceSessionOptions(signedUrl: string, pdf: ScholarPdfContext) {
  return {
    signedUrl,
    connectionType: "websocket" as const,
    overrides: {
      agent: {
        prompt: {
          prompt: buildScholarPrompt(pdf),
        },
        firstMessage: buildScholarFirstMessage(pdf),
      },
    },
  };
}