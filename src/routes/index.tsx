import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { extractPdfText } from "@/lib/scholar/pdf";
import { useScholarStore } from "@/lib/scholar/store";
import { FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Multimodal Scholar — drop a PDF to start learning" },
      {
        name: "description",
        content:
          "Drop a PDF and have a voice conversation with an AI scholar that visualizes and researches in real time.",
      },
    ],
  }),
});

function Index() {
  const navigate = useNavigate();
  const setPdf = useScholarStore((s) => s.setPdf);
  const inputRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [dragging, setDragging] = useState(false);

  const handleFile = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF");
      return;
    }
    setParsing(true);
    try {
      const { text, pages } = await extractPdfText(file, (p, t) =>
        setProgress(`Parsing page ${p}/${t}…`),
      );
      setPdf({ name: file.name, text, pages, charCount: text.length });
      navigate({ to: "/session" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to parse PDF");
    } finally {
      setParsing(false);
      setProgress("");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <Toaster theme="dark" richColors />
      <div className="w-full max-w-2xl">
        <label
          htmlFor="pdf"
          onDragOver={(e) => {
            e.preventDefault();
            if (!parsing) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={`group flex cursor-pointer flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed bg-card p-16 text-center transition-all ${
            dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/60 hover:bg-card/80"
          } ${parsing ? "pointer-events-none opacity-70" : ""} ring-glow`}
        >
          {parsing ? (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-base">{progress || "Parsing PDF…"}</p>
            </>
          ) : (
            <>
              <div className="rounded-full bg-primary/10 p-5 transition-transform group-hover:scale-110">
                <Upload className="h-10 w-10 text-primary" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-glow">
                  Drop a PDF to start learning
                </h1>
                <p className="text-sm text-muted-foreground">
                  Drag &amp; drop your paper here, or click to browse
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  inputRef.current?.click();
                }}
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
              >
                <FileText className="h-4 w-4" />
                Choose a PDF
              </button>
            </>
          )}
          <input
            ref={inputRef}
            id="pdf"
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </label>
      </div>
    </div>
  );
}
