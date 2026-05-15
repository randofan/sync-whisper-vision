import "katex/dist/katex.min.css";
import { BlockMath } from "react-katex";

interface Props {
  steps: string[];
  inline?: string;
}

export function MathView({ steps, inline }: Props) {
  return (
    <div className="space-y-3 text-foreground">
      {inline && (
        <p className="text-sm text-muted-foreground italic">{inline}</p>
      )}
      {steps.map((s, i) => (
        <div
          key={i}
          className="rounded-md bg-muted/40 p-3 overflow-x-auto"
        >
          <BlockMath math={s} />
        </div>
      ))}
    </div>
  );
}
