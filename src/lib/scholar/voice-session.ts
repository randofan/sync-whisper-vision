export interface ScholarPdfContext {
  name: string;
  pages: number;
  text: string;
}

export function buildScholarPrompt(pdf: ScholarPdfContext) {
  return `You are "Scholar", a peer-level technical research companion. The user uploaded "${pdf.name}" (${pdf.pages} pages). Use the extracted paper text below as the primary source.

Be concise. Keep each response to 2–4 short sentences unless the user asks for depth. Use client tools whenever a citation lookup or derivation would help: research, deep_think.

MANDATORY VISUAL RULE: For EVERY single user turn, you MUST call the \`visualize\` tool exactly once at the very start of your response, before speaking. Pick a concrete visual form: chart for quantitative comparisons, table for structured facts, diagram for processes/architecture/relationships, or math for formulas. Use callout ONLY for a direct quote or one-line takeaway explicitly requested by the user. The \`hint\` must name the desired visual type and concrete contents, not a sentence like "a table summarizing..." or "callout summarizing...". Never skip the visualization, even for short answers — always find an angle worth illustrating. The tool is fire-and-forget, so call it first and keep talking; the slide will render on the canvas while you speak.

PAPER CONTENT:
"""
${pdf.text.slice(0, 29_000)}
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