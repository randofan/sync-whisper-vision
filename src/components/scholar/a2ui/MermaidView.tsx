import { useEffect, useRef } from "react";
import { themes, type ThemeType } from "@/lib/mermaid/themes";

interface Props {
  source: string;
  /** Theme from the modern_mermaid theme catalog. Defaults to "handDrawn". */
  theme?: ThemeType;
}

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let currentTheme: ThemeType | null = null;

async function getMermaid(theme: ThemeType) {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  const mermaid = await mermaidPromise;
  if (currentTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      ...themes[theme].mermaidConfig,
    });
    currentTheme = theme;
  }
  return mermaid;
}

export function MermaidView({ source, theme = "handDrawn" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2)}`);
  const themeCfg = themes[theme];

  useEffect(() => {
    let cancelled = false;
    getMermaid(theme).then(async (mermaid) => {
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
  }, [source, theme]);

  return (
    <div
      className={`flex justify-center overflow-x-auto rounded-lg p-6 ${themeCfg.bgClass}`}
      style={themeCfg.bgStyle}
    >
      <div ref={ref} className="w-full flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" />
    </div>
  );
}
