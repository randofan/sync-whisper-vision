import { useEffect, useRef } from "react";

interface Props {
  source: string;
}

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: "dark",
        themeVariables: {
          background: "transparent",
          primaryColor: "#1f2937",
          primaryTextColor: "#e5e7eb",
          primaryBorderColor: "#3f3f46",
          lineColor: "#71717a",
        },
        securityLevel: "loose",
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

export function MermaidView({ source }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    getMermaid().then(async (mermaid) => {
      try {
        const { svg } = await mermaid.render(idRef.current, source);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (err) {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = `<pre class="text-xs text-destructive p-2">${
            err instanceof Error ? err.message : "diagram render failed"
          }</pre>`;
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source]);

  return <div ref={ref} className="flex justify-center overflow-x-auto" />;
}
