import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { extractPdfText } from "@/lib/scholar/pdf";
import { useScholarStore } from "@/lib/scholar/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, Loader2, Mic, Sparkles, Search, Brain } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Multimodal Scholar — voice research companion" },
      {
        name: "description",
        content:
          "Upload a paper and have a peer-level voice conversation with an AI scholar that visualizes, researches, and reasons in real time.",
      },
    ],
  }),
});

function Index() {
  const navigate = useNavigate();
  const setPdf = useScholarStore((s) => s.setPdf);
  const agentId = useScholarStore((s) => s.agentId);
  const setAgentId = useScholarStore((s) => s.setAgentId);

  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const handleFile = async (file: File) => {
    if (!agentId.trim()) {
      toast.error("Enter your ElevenLabs Agent ID first");
      return;
    }
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
    <div className="min-h-screen">
      <Toaster theme="dark" richColors />
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-12">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-muted-foreground">Asynchronous multimodal research</span>
          </div>
          <h1 className="text-5xl font-semibold tracking-tight text-glow">
            Multimodal Scholar
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground leading-relaxed">
            Upload a technical paper. Talk to it. While you discuss, an illustrator subagent
            renders charts, derivations, and diagrams on a live canvas, and a background research
            agent surfaces external context — all without interrupting the conversation.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-3 mb-10">
          {[
            { icon: Mic, label: "Voice", desc: "ElevenLabs WebRTC conversation, sub-500ms feel." },
            { icon: Sparkles, label: "Illustrator", desc: "Charts, math, diagrams streamed to canvas." },
            { icon: Search, label: "Research", desc: "Web search + arXiv pulled in parallel." },
          ].map((f) => (
            <div key={f.label} className="rounded-lg border border-border bg-card p-4">
              <f.icon className="h-4 w-4 text-primary" />
              <p className="mt-2 text-sm font-semibold">{f.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>

        <section className="rounded-xl border border-border bg-card p-6 ring-glow">
          <div className="space-y-5">
            <div>
              <Label htmlFor="agent">ElevenLabs Agent ID</Label>
              <Input
                id="agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="agent_xxxxxxxx"
                className="mt-1.5 font-mono text-sm"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Create an agent in ElevenLabs and add the three client tools (
                <code className="text-foreground">visualize</code>,{" "}
                <code className="text-foreground">research</code>,{" "}
                <code className="text-foreground">deep_think</code>). See setup notes below.
              </p>
            </div>

            <div>
              <Label>Research paper (PDF)</Label>
              <label
                htmlFor="pdf"
                className={`mt-1.5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background p-10 transition-colors hover:border-primary/60 ${parsing ? "pointer-events-none opacity-60" : ""}`}
              >
                {parsing ? (
                  <>
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm">{progress || "Parsing PDF…"}</p>
                  </>
                ) : (
                  <>
                    <FileText className="h-6 w-6 text-primary" />
                    <p className="text-sm font-medium">Drop a PDF or click to upload</p>
                    <p className="text-xs text-muted-foreground">
                      Parsed in your browser · session only · max ~250k chars
                    </p>
                  </>
                )}
                <input
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

            <div className="flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
              <Link to="/setup" className="underline-offset-2 hover:underline hover:text-foreground">
                Agent setup instructions →
              </Link>
              <span className="flex items-center gap-1">
                <Brain className="h-3 w-3" /> Powered by Lovable AI + ElevenLabs
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
