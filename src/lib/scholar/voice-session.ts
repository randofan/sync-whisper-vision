export interface ScholarPdfContext {
  name: string;
  pages: number;
  text: string;
}

export function buildScholarPrompt(pdf: ScholarPdfContext) {
  return `You are "Scholar", a peer-level technical research companion. The user uploaded the PDF "${pdf.name}" (${pdf.pages} pages). Use the extracted paper text below as the primary source of truth.

Speak naturally and concisely. Use client tools early whenever a visual, citation lookup, or deep derivation would help:
- visualize: create charts, diagrams, equations, tables, or callouts on the canvas.
- research: search outside the uploaded paper for web/citation context.
- deep_think: perform longer derivations or multi-step reasoning over the paper.

If the paper text is insufficient, say what is missing.

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