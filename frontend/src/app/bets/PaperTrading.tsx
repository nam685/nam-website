"use client";

import { useEffect, useState } from "react";

import EquityCurve from "@/components/EquityCurve";
import { API, type BetsTicker, type PaperAccount, type PaperDetail, type StrategyInfo } from "@/lib/api";
import { store } from "@/lib/auth";
import { fmtMoney, fmtPct } from "@/lib/backtest";

export default function PaperTrading({
  tickers,
  strategies,
  accent,
  isAdmin,
}: {
  tickers: BetsTicker[];
  strategies: StrategyInfo[];
  accent: string;
  isAdmin: boolean;
}) {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [details, setDetails] = useState<Record<number, PaperDetail>>({});

  function load() {
    fetch(`${API}/api/bets/paper/`)
      .then((r) => r.json())
      .then(setAccounts);
  }
  useEffect(load, []);

  async function expand(id: number) {
    if (details[id]) return;
    const d = await fetch(`${API}/api/bets/paper/${id}/`).then((r) => r.json());
    setDetails((prev) => ({ ...prev, [id]: d }));
  }

  async function create(tickerId: number, strategy: string) {
    const token = store("adminToken");
    await fetch(`${API}/api/bets/paper/create/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ticker_id: tickerId, strategy, params: {}, starting_cash: 10000 }),
    });
    load();
  }

  async function action(id: number, verb: "stop" | "delete") {
    const token = store("adminToken");
    await fetch(`${API}/api/bets/paper/${id}/${verb}/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    load();
  }

  if (accounts.length === 0 && !isAdmin) return null;

  return (
    <section style={{ marginTop: "3rem" }}>
      <h2 className="tag">Paper trading</h2>

      {isAdmin && <AdminCreate tickers={tickers} strategies={strategies} accent={accent} onCreate={create} />}

      <div style={{ display: "grid", gap: "1.5rem", marginTop: "1rem" }}>
        {accounts.map((a) => {
          const d = details[a.id];
          return (
            <div key={a.id} className="corner-tl corner-br" style={{ padding: "1rem", border: "1px solid #333" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>
                  {a.ticker.symbol} · {a.strategy} {a.is_active ? "" : "(stopped)"}
                </strong>
                <span>
                  {a.current_value !== null ? fmtMoney(a.current_value) : "—"}{" "}
                  {a.metrics && (
                    <span style={{ color: a.metrics.total_return_pct >= 0 ? "#22c55e" : "#ef4444" }}>
                      {fmtPct(a.metrics.total_return_pct)}
                    </span>
                  )}
                </span>
              </div>

              <p style={{ fontSize: "0.8rem", color: "#888" }}>
                {a.in_position ? "● holding" : "○ in cash"} · since {a.started_on}
              </p>

              <button onClick={() => expand(a.id)} style={{ fontSize: "0.75rem" }}>
                {d ? "" : "Show chart"}
              </button>

              {d && (
                <EquityCurve strategy={d.equity_curve} dates={d.dates} trades={d.trades} accent={accent} />
              )}

              {isAdmin && (
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {a.is_active && (
                    <button onClick={() => action(a.id, "stop")} style={{ fontSize: "0.75rem" }}>
                      Stop
                    </button>
                  )}
                  <button onClick={() => action(a.id, "delete")} style={{ fontSize: "0.75rem", color: "#ef4444" }}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AdminCreate({
  tickers,
  strategies,
  accent,
  onCreate,
}: {
  tickers: BetsTicker[];
  strategies: StrategyInfo[];
  accent: string;
  onCreate: (tickerId: number, strategy: string) => void;
}) {
  const [tickerId, setTickerId] = useState<number>(tickers[0]?.id ?? 0);
  const [strategy, setStrategy] = useState<string>(strategies[0]?.key ?? "");
  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <select value={tickerId} onChange={(e) => setTickerId(Number(e.target.value))}>
        {tickers.map((t) => (
          <option key={t.id} value={t.id}>
            {t.symbol}
          </option>
        ))}
      </select>
      <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
        {strategies.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <button onClick={() => onCreate(tickerId, strategy)} style={{ borderColor: accent, color: accent }}>
        Start paper run
      </button>
    </div>
  );
}
