"use client";

import type { BacktestTrade } from "@/lib/api";

const W = 600;
const H = 220;

export default function EquityCurve({
  strategy,
  benchmark,
  dates,
  trades,
  accent,
}: {
  strategy: number[];
  benchmark: number[];
  dates: string[];
  trades: BacktestTrade[];
  accent: string;
}) {
  if (strategy.length < 2) return null;
  const all = [...strategy, ...benchmark];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const step = W / (strategy.length - 1);
  const dateIndex = (d: string) => dates.indexOf(d);
  const yFor = (v: number) => H - ((v - min) / span) * H;

  const pts = (curve: number[]) =>
    curve.map((v, i) => `${(i * step).toFixed(2)},${yFor(v).toFixed(2)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} aria-label="Equity curve">
      <polyline points={pts(benchmark)} fill="none" stroke="#888" strokeWidth={1.5} strokeDasharray="4 3" />
      <polyline points={pts(strategy)} fill="none" stroke={accent} strokeWidth={2} />
      {trades.map((t, i) => {
        const idx = dateIndex(t.date);
        if (idx < 0) return null;
        return (
          <circle
            key={i}
            cx={(idx * step).toFixed(2)}
            cy={yFor(strategy[idx]).toFixed(2)}
            r={3}
            fill={t.side === "buy" ? "#22c55e" : "#ef4444"}
          />
        );
      })}
    </svg>
  );
}
