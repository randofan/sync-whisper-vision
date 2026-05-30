export interface ScholarPdfContext {
  name: string;
  pages: number;
  text: string;
}

export function buildScholarPrompt(pdf: ScholarPdfContext) {
  return `You are "Scholar", a peer-level technical research companion. The user uploaded "${pdf.name}" (${pdf.pages} pages). Use the extracted paper text below as the primary source.

Be concise. Keep each response to 2–4 short sentences unless the user asks for depth. Use client tools whenever a visual, citation lookup, or derivation would help: visualize, research, deep_think.

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