// Client-only PDF text extraction using pdfjs-dist.
// IMPORTANT: only call from the browser (e.g. inside an event handler / useEffect).

export async function extractPdfText(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  // Use a worker URL bundled by Vite.
  const workerMod = (await import("pdfjs-dist/build/pdf.worker.mjs?url")) as { default: string };
  const workerUrl = workerMod.default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const total = doc.numPages;
  const parts: string[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => ("str" in it ? it.str : ""))
      .join(" ");
    parts.push(`\n\n--- Page ${i} ---\n${pageText}`);
    onProgress?.(i, total);
  }

  let text = parts.join("");
  // Cap to ~250k chars to fit context window.
  const MAX = 250_000;
  if (text.length > MAX) text = text.slice(0, MAX) + "\n\n[truncated]";
  return { text, pages: total };
}
