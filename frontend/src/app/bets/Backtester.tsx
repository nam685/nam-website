"use client";

import { useEffect, useState } from "react";

import EquityCurve from "@/components/EquityCurve";
import { API, type BacktestResult, type BetsTicker, type StrategyInfo } from "@/lib/api";
import { fmtPct } from "@/lib/backtest";

export default function Backtester({ tickers, accent }: { tickers: BetsTicker[]; accent: string }) {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([]);
  const [tickerId, setTickerId] = useState<number | null>(null);
  const [strategyKey, setStrategyKey] = useState<string>("");
  const [params, setParams] = useState<Record<string, number>>({});
  const [period, setPeriod] = useState("ALL");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/bets/strategies/`)
      .then((r) => r.json())
      .then((data: StrategyInfo[]) => {
        setStrategies(data);
        if (data.length) selectStrategy(data[0]);
      });
    if (tickers.length) setTickerId(tickers[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectStrategy(s: StrategyInfo) {
    setStrategyKey(s.key);
    setParams(Object.fromEntries(s.params.map((p) => [p.name, p.default])));
  }

  const current = strategies.find((s) => s.key === strategyKey);

  async function run() {
    if (!tickerId || !strategyKey) return;
    setRunning(true);
    setError(null);
    try {
      const resp = await fetch(`${API}/api/bets/backtest/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker_id: tickerId, strategy: strategyKey, params, period }),
      });
      const body = await resp.json();
      if (!resp.ok) {
        setError(body.error || "Backtest failed");
        setResult(null);
      } else {
        setResult(body);
      }
    } catch {
      setError("Network error");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section style={{ marginTop: "3rem" }}>
      <h2 className="tag">Backtest sandbox</h2>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        <select value={tickerId ?? ""} onChange={(e) => setTickerId(Number(e.target.value))}>
          {tickers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.symbol} — {t.name}
            </option>
          ))}
        </select>

        <select
          value={strategyKey}
          onChange={(e) => selectStrategy(strategies.find((s) => s.key === e.target.value)!)}
        >
          {strategies.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>

        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {["1Y", "3M", "1M", "ALL"].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {current?.params.map((p) => (
          <label key={p.name} style={{ display: "flex", flexDirection: "column", fontSize: "0.8rem" }}>
            {p.label}
            <input
              type="number"
              value={params[p.name] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.type === "int" ? 1 : 0.1}
              onChange={(e) => setParams({ ...params, [p.name]: Number(e.target.value) })}
              style={{ width: 90 }}
            />
          </label>
        ))}

        <button onClick={run} disabled={running} style={{ borderColor: accent, color: accent }}>
          {running ? "Running…" : "Run backtest"}
        </button>
      </div>

      {error && <p style={{ color: "#ef4444" }}>{error}</p>}

      {result && (
        <div>
          <EquityCurve
            strategy={result.equity_curve}
            benchmark={result.benchmark_curve}
            dates={result.dates}
            trades={result.trades}
            accent={accent}
          />
          <p style={{ fontSize: "0.75rem", color: "#888" }}>
            <span style={{ color: accent }}>━ strategy</span> &nbsp; <span>┄ buy &amp; hold</span>
          </p>
          <MetricsTable m={result} />
        </div>
      )}
    </section>
  );
}

function MetricsTable({ m }: { m: BacktestResult }) {
  const rows: [string, string, string][] = [
    ["Total return", fmtPct(m.metrics.total_return_pct), fmtPct(m.benchmark_metrics.total_return_pct)],
    ["CAGR", fmtPct(m.metrics.cagr_pct), fmtPct(m.benchmark_metrics.cagr_pct)],
    ["Max drawdown", fmtPct(m.metrics.max_drawdown_pct), fmtPct(m.benchmark_metrics.max_drawdown_pct)],
    ["Sharpe", m.metrics.sharpe.toFixed(2), m.benchmark_metrics.sharpe.toFixed(2)],
    ["Trades", String(m.metrics.num_trades), String(m.benchmark_metrics.num_trades)],
    ["Win rate", fmtPct(m.metrics.win_rate_pct), "—"],
  ];
  return (
    <table style={{ width: "100%", fontSize: "0.85rem", marginTop: "1rem" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Metric</th>
          <th style={{ textAlign: "right" }}>Strategy</th>
          <th style={{ textAlign: "right" }}>Buy &amp; Hold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, a, b]) => (
          <tr key={label}>
            <td>{label}</td>
            <td style={{ textAlign: "right" }}>{a}</td>
            <td style={{ textAlign: "right", color: "#888" }}>{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
