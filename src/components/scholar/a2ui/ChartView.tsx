import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { ChartSpec } from "@/lib/scholar/store";

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

export function ChartView({ spec }: { spec: ChartSpec }) {
  const common = (
    <>
      <CartesianGrid stroke="var(--mono-grid)" strokeDasharray="3 3" />
      <XAxis
        dataKey={spec.xKey}
        stroke="var(--color-muted-foreground)"
        fontSize={11}
        label={
          spec.xLabel
            ? { value: spec.xLabel, position: "insideBottom", offset: -4, fill: "var(--color-muted-foreground)" }
            : undefined
        }
      />
      <YAxis
        stroke="var(--color-muted-foreground)"
        fontSize={11}
        label={
          spec.yLabel
            ? { value: spec.yLabel, angle: -90, position: "insideLeft", fill: "var(--color-muted-foreground)" }
            : undefined
        }
      />
      <Tooltip
        contentStyle={{
          background: "var(--color-popover)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          fontSize: 12,
        }}
      />
      <Legend wrapperStyle={{ fontSize: 11 }} />
    </>
  );

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {spec.chartType === "line" ? (
          <LineChart data={spec.data} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            {common}
            {spec.yKeys.map((k, i) => (
              <Line key={k} dataKey={k} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        ) : spec.chartType === "bar" ? (
          <BarChart data={spec.data} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            {common}
            {spec.yKeys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        ) : spec.chartType === "area" ? (
          <AreaChart data={spec.data} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            {common}
            {spec.yKeys.map((k, i) => (
              <Area key={k} dataKey={k} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.25} />
            ))}
          </AreaChart>
        ) : (
          <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
            {common}
            {spec.yKeys.map((k, i) => (
              <Scatter key={k} data={spec.data} dataKey={k} fill={COLORS[i % COLORS.length]} />
            ))}
          </ScatterChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
