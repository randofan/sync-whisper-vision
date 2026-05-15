export interface ScholarPdfContext {
  name: string;
  pages: number;
  text: string;
}

export function buildScholarPrompt(pdf: ScholarPdfContext) {
  return `You are "Scholar", a peer-level technical research companion. The user uploaded the PDF "${pdf.name}" (${pdf.pages} pages). Use the extracted paper text below as the primary source of truth.

Speak naturally and concisely. Use client tools early whenever a visual, citation lookup, or deep derivation would help. If the paper text is insufficient, say what is missing.

PAPER CONTENT:
"""
${pdf.text.slice(0, 30_000)}
"""`;
}

export function buildScholarVoiceSessionOptions(signedUrl: string, pdf: ScholarPdfContext | null) {
  return {
    signedUrl,
    connectionType: "websocket" as const,
    overrides: pdf
      ? {
          agent: {
            prompt: { prompt: buildScholarPrompt(pdf) },
            firstMessage: `I've read "${pdf.name}". What would you like to dig into first?`,
          },
        }
      : undefined,
  };
}