import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useScholarStore } from "@/lib/scholar/store";
import { VoicePanel } from "@/components/scholar/VoicePanel";
import { CanvasPane } from "@/components/scholar/CanvasPane";
import { Toaster } from "@/components/ui/sonner";
import { ArrowLeft } from "lucide-react";


export const Route = createFileRoute("/session")({
  component: SessionPage,
  ssr: false,
  head: () => ({
    meta: [{ title: "Session · Multimodal Scholar" }],
  }),
});

function SessionPage() {
  const pdf = useScholarStore((s) => s.pdf);
  const navigate = useNavigate();
  

  useEffect(() => {
    // Wait one tick for zustand/persist sessionStorage hydration before redirecting.
    const t = setTimeout(() => {
      if (!useScholarStore.getState().pdf) navigate({ to: "/" });
    }, 50);
    return () => clearTimeout(t);
  }, [navigate]);

  if (!pdf) return <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading session…</div>;

  return (
    <div className="flex h-screen flex-col">
      <Toaster theme="dark" richColors />
      <header className="flex items-center justify-between border-b border-border bg-card/60 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{pdf.name}</p>
            <p className="text-[11px] text-muted-foreground">
              {pdf.pages} pages · {(pdf.charCount / 1000).toFixed(0)}k chars in context
            </p>
          </div>
        </div>
        <h1 className="hidden md:block text-xs uppercase tracking-widest text-muted-foreground">
          Multimodal Scholar
        </h1>
      </header>

      <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[320px_1fr_320px]">
        <aside className="border-r border-border bg-card/30 min-h-0">
          <VoicePanel />
        </aside>
        <main className="overflow-y-auto bg-background min-h-0">
          <CanvasPane />
        </main>
        <aside className="border-l border-border bg-card/30 overflow-y-auto min-h-0">
          <ResearchFeed />
        </aside>
      </div>
    </div>
  );
}
