import { useScholarStore, type CanvasItem } from "@/lib/scholar/store";
import { ChartView } from "./a2ui/ChartView";
import { MathView } from "./a2ui/MathView";
import { MermaidView } from "./a2ui/MermaidView";
import { TableView } from "./a2ui/TableView";
import { Loader2, Sparkles } from "lucide-react";

function CardChrome({
  item,
  children,
}: {
  item: CanvasItem;
  children: React.ReactNode;
}) {
  return (
    <div className="slide-in-up rounded-lg border border-border bg-card p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" />
            <span>Visual</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {new Date(item.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground truncate">{item.title}</h3>
          {item.narration && (
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{item.narration}</p>
          )}
        </div>
      </header>
      <div>{children}</div>
    </div>
  );
}

export function CanvasPane() {
  const items = useScholarStore((s) => s.canvasItems);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground p-8">
        <div className="rounded-full border border-border bg-card p-4">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">Visualization canvas</p>
        <p className="max-w-xs text-xs">
          Charts, derivations, and diagrams will appear here as the agent illustrates concepts in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {items.map((item) => (
        <CardChrome key={item.id} item={item}>
          {item.status === "pending" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating visual…
            </div>
          )}
          {item.status === "error" && (
            <p className="text-xs text-destructive">{item.error ?? "Failed."}</p>
          )}
          {item.status === "ready" && item.payload && (
            <>
              {item.payload.kind === "chart" && <ChartView spec={item.payload.spec} />}
              {item.payload.kind === "math" && (
                <MathView steps={item.payload.spec.steps} inline={item.payload.spec.inline} />
              )}
              {item.payload.kind === "diagram" && (
                <MermaidView source={item.payload.spec.mermaid} />
              )}
              {item.payload.kind === "table" && <TableView spec={item.payload.spec} />}
              {item.payload.kind === "callout" && (
                <p className="rounded-md bg-muted/40 p-3 text-sm">{item.payload.spec.body}</p>
              )}
            </>
          )}
        </CardChrome>
      ))}
    </div>
  );
}
