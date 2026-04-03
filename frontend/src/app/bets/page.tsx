"use client";

import { useEffect, useState } from "react";
import { store } from "@/lib/auth";
import { API } from "@/lib/api";
import type { BetsTicker, BetsHistory, BetsSearchResult } from "@/lib/api";

const ACCENT = "#db2777";
const GREEN = "#22c55e";
const RED = "#ef4444";

function formatPrice(price: string | null, currency: string): string {
  if (!price) return "—";
  const num = parseFloat(price);
  if (currency === "%") return `${num.toFixed(2)}%`;
  const symbol = currency === "EUR" ? "€" : "$";
  if (num >= 10000)
    return `${symbol}${num.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  return `${symbol}${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatChange(pct: string | null): { text: string; color: string } {
  if (!pct) return { text: "—", color: "#555" };
  const num = parseFloat(pct);
  const sign = num >= 0 ? "+" : "";
  return { text: `${sign}${num.toFixed(2)}%`, color: num >= 0 ? GREEN : RED };
}

function Sparkline({
  data,
  color,
  height = 32,
}: {
  data: number[];
  color: string;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 200;
  const pad = 2;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = pad + ((max - v) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: "100%", height }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        opacity="0.7"
      />
    </svg>
  );
}

const PERIODS = ["1W", "1M", "3M", "1Y", "ALL"] as const;

function ExpandedCard({
  ticker,
  history,
  period,
  onPeriodChange,
  onClose,
}: {
  ticker: BetsTicker;
  history: BetsHistory;
  period: string;
  onPeriodChange: (p: string) => void;
  onClose: () => void;
}) {
  const change = formatChange(ticker.change_pct);
  const prices = history.prices.map((p) => parseFloat(p.price));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const chartH = 160;
  const chartW = 500;
  const pad = 8;

  const linePoints = prices
    .map((v, i) => {
      const x =
        prices.length > 1 ? (i / (prices.length - 1)) * chartW : chartW / 2;
      const y = pad + ((max - v) / range) * (chartH - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `0,${chartH} ${linePoints} ${chartW},${chartH}`;

  return (
    <div
      onClick={onClose}
      style={{
        border: `1px solid ${ACCENT}66`,
        padding: 20,
        marginBottom: 12,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "#555",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {ticker.asset_type}
          </div>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              color: "#eee",
              marginTop: 2,
            }}
          >
            {ticker.symbol}{" "}
            <span style={{ fontSize: 13, color: "#666", fontWeight: 400 }}>
              {ticker.name}
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 22, fontFamily: "monospace", color: "#eee" }}>
            {formatPrice(ticker.price, ticker.currency)}
          </div>
          <div
            style={{
              fontSize: 14,
              fontFamily: "monospace",
              color: change.color,
            }}
          >
            {change.text} today
          </div>
        </div>
      </div>

      {/* Period toggles */}
      <div
        style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}
        onClick={(e) => e.stopPropagation()}
      >
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              color: p === period ? ACCENT : "#888",
              border: `1px solid ${p === period ? `${ACCENT}88` : "#333"}`,
              background: p === period ? `${ACCENT}1a` : "transparent",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chart */}
      {prices.length >= 2 && (
        <div
          style={{
            height: chartH,
            border: "1px solid #1a1a1a",
            padding: 8,
            position: "relative",
          }}
        >
          <svg
            viewBox={`0 0 ${chartW} ${chartH}`}
            style={{ width: "100%", height: "100%" }}
          >
            {[0.25, 0.5, 0.75].map((frac) => (
              <line
                key={frac}
                x1="0"
                y1={chartH * frac}
                x2={chartW}
                y2={chartH * frac}
                stroke="#1a1a1a"
                strokeWidth="0.5"
              />
            ))}
            <defs>
              <linearGradient
                id={`grad-${ticker.id}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={change.color} />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
            </defs>
            <polygon
              points={areaPoints}
              fill={`url(#grad-${ticker.id})`}
              opacity="0.3"
            />
            <polyline
              points={linePoints}
              fill="none"
              stroke={change.color}
              strokeWidth="2"
            />
          </svg>
          <div
            style={{
              position: "absolute",
              right: 4,
              top: 8,
              fontSize: 10,
              color: "#444",
              fontFamily: "monospace",
            }}
          >
            {formatPrice(String(max), ticker.currency)}
          </div>
          <div
            style={{
              position: "absolute",
              right: 4,
              bottom: 8,
              fontSize: 10,
              color: "#444",
              fontFamily: "monospace",
            }}
          >
            {formatPrice(String(min), ticker.currency)}
          </div>
        </div>
      )}

      {/* Change periods */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 16,
          flexWrap: "wrap",
        }}
      >
        {PERIODS.map((p) => {
          const val = history.change_periods[p];
          const c = formatChange(val);
          return (
            <div key={p}>
              <div
                style={{
                  fontSize: 10,
                  color: "#555",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {p}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontFamily: "monospace",
                  color: c.color,
                }}
              >
                {c.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function BetsPage() {
  const [tickers, setTickers] = useState<BetsTicker[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [history, setHistory] = useState<BetsHistory | null>(null);
  const [historyPeriod, setHistoryPeriod] = useState("1M");
  const [isAdmin, setIsAdmin] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<BetsSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setIsAdmin(!!store("adminToken"));
    fetch(`${API}/api/bets/`)
      .then((r) => r.json())
      .then(setTickers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!expandedId) {
      setHistory(null);
      return;
    }
    fetch(`${API}/api/bets/${expandedId}/history/?period=${historyPeriod}`)
      .then((r) => r.json())
      .then(setHistory)
      .catch(console.error);
  }, [expandedId, historyPeriod]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      const token = store("adminToken");
      fetch(`${API}/api/bets/search/?q=${encodeURIComponent(searchQuery)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setSearchResults(data);
        })
        .catch(console.error)
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const token = store("adminToken");
      await fetch(`${API}/api/bets/sync/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const r = await fetch(`${API}/api/bets/`);
      setTickers(await r.json());
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const handleSelect = async (result: BetsSearchResult) => {
    const token = store("adminToken");
    const resp = await fetch(`${API}/api/bets/create/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(result),
    });
    if (resp.ok) {
      setShowSearch(false);
      setSearchQuery("");
      setSearchResults([]);
      const r = await fetch(`${API}/api/bets/`);
      setTickers(await r.json());
    }
  };

  const handleDelete = async (id: number) => {
    const token = store("adminToken");
    await fetch(`${API}/api/bets/${id}/delete/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    setTickers((prev) => prev.filter((t) => t.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const updatedAt = tickers.find((t) => t.updated_at)?.updated_at;

  if (loading) {
    return (
      <div
        style={{
          padding: "80px 24px 24px",
          maxWidth: 900,
          margin: "0 auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 2,
            color: ACCENT,
          }}
        >
          Markets
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "80px 16px 24px",
        maxWidth: 900,
        margin: "0 auto",
        position: "relative",
        zIndex: 1,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 2,
              color: ACCENT,
            }}
          >
            Markets
          </div>
          {updatedAt && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
              Last updated: {updatedAt}
            </div>
          )}
        </div>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowSearch(!showSearch)}
              style={{
                padding: "4px 10px",
                border: `1px solid ${ACCENT}44`,
                fontSize: 11,
                color: ACCENT,
                background: "transparent",
                cursor: "pointer",
                borderRadius: 2,
              }}
            >
              + Add Ticker
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                padding: "4px 10px",
                border: `1px solid ${ACCENT}44`,
                fontSize: 11,
                color: "#555",
                background: "transparent",
                cursor: "pointer",
                borderRadius: 2,
              }}
            >
              {syncing ? "syncing..." : "↻ Refresh"}
            </button>
          </div>
        )}
      </div>

      {/* Search typeahead */}
      {showSearch && (
        <div
          style={{
            border: `1px solid ${ACCENT}33`,
            padding: 12,
            marginBottom: 16,
            position: "relative",
          }}
        >
          <input
            autoFocus
            placeholder="Search ticker (e.g. VWCE, Bitcoin)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: "#111",
              border: "1px solid #333",
              color: "#eee",
              padding: "8px 12px",
              fontSize: 14,
              width: "100%",
              boxSizing: "border-box",
            }}
          />
          {searching && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
              Searching...
            </div>
          )}
          {!searching && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
              No results
            </div>
          )}
          {searchResults.length > 0 && (
            <div
              style={{
                marginTop: 4,
                maxHeight: 240,
                overflowY: "auto",
                border: "1px solid #222",
                background: "#0a0a0a",
              }}
            >
              {searchResults.map((r) => (
                <div
                  key={`${r.provider}-${r.symbol}`}
                  onClick={() => handleSelect(r)}
                  style={{
                    padding: "8px 12px",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid #1a1a1a",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#151515")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <div>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "#eee",
                        fontSize: 14,
                      }}
                    >
                      {r.symbol}
                    </span>
                    <span
                      style={{
                        color: "#666",
                        fontSize: 12,
                        marginLeft: 8,
                      }}
                    >
                      {r.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      color: "#555",
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      border: "1px solid #333",
                      padding: "2px 6px",
                    }}
                  >
                    {r.asset_type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded card */}
      {expandedId && history && (
        <ExpandedCard
          ticker={tickers.find((t) => t.id === expandedId)!}
          history={history}
          period={historyPeriod}
          onPeriodChange={setHistoryPeriod}
          onClose={() => setExpandedId(null)}
        />
      )}

      {/* Card grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: expandedId
            ? "repeat(auto-fill, minmax(140px, 1fr))"
            : "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 12,
          opacity: expandedId ? 0.6 : 1,
          transition: "opacity 0.2s",
        }}
      >
        {tickers
          .filter((t) => t.id !== expandedId)
          .map((t) => {
            const change = formatChange(t.change_pct);
            return (
              <div
                key={t.id}
                onClick={() => {
                  setExpandedId(t.id);
                  setHistoryPeriod("1M");
                }}
                style={{
                  border: "1px solid #222",
                  padding: expandedId ? 12 : 16,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  position: "relative",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "#444")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "#222")
                }
              >
                {isAdmin && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(t.id);
                    }}
                    style={{
                      position: "absolute",
                      top: 4,
                      right: 8,
                      background: "none",
                      border: "none",
                      color: "#444",
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                    title="Remove ticker"
                  >
                    ×
                  </button>
                )}
                {expandedId ? (
                  <>
                    <div style={{ fontSize: 14, color: "#eee" }}>
                      {t.symbol}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: change.color,
                      }}
                    >
                      {formatPrice(t.price, t.currency)} {change.text}
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#555",
                            textTransform: "uppercase",
                            letterSpacing: 1,
                          }}
                        >
                          {t.asset_type}
                        </div>
                        <div
                          style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: "#eee",
                            marginTop: 2,
                          }}
                        >
                          {t.symbol}
                        </div>
                        <div
                          style={{ fontSize: 11, color: "#666", marginTop: 2 }}
                        >
                          {t.name}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            fontSize: 18,
                            fontFamily: "monospace",
                            color: "#eee",
                          }}
                        >
                          {formatPrice(t.price, t.currency)}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontFamily: "monospace",
                            color: change.color,
                          }}
                        >
                          {change.text}
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <Sparkline data={t.sparkline} color={change.color} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>

      {!loading && tickers.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: "#555",
            marginTop: 48,
            fontSize: 14,
          }}
        >
          No tickers tracked yet.
          {isAdmin && " Click '+ Add Ticker' to get started."}
        </div>
      )}
    </div>
  );
}
