"use client";

import { useState, useCallback, useEffect } from "react";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { parseUci, makeUci } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import type { Key } from "chessground/types";
import ChessgroundBoard from "./ChessgroundBoard";
import { fetchExplorer, type ExplorerResponse, type ExplorerDb } from "@/lib/lichessApi";
import { lookupPosition } from "@/lib/chessOpenings";

const ACCENT = "#06b6d4";

interface HistoryEntry {
  san: string;
  uci: string;
  fen: string;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pct(n: number, total: number): string {
  if (total === 0) return "0";
  return Math.round((n / total) * 100).toString();
}

export default function OpeningExplorer() {
  const [position, setPosition] = useState<Chess>(Chess.default());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [explorerDb, setExplorerDb] = useState<ExplorerDb>("masters");
  const [explorerData, setExplorerData] = useState<ExplorerResponse | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<number[]>([]);
  const [isLive, setIsLive] = useState(false);

  const fen = makeFen(position.toSetup());
  const turnColor = position.turn === "white" ? "white" : "black";
  const lastMove =
    history.length > 0 ? (history[history.length - 1].uci.match(/.{2}/g) as [Key, Key]) : undefined;
  const isCheck = position.isCheck();
  const dests = chessgroundDests(position);

  // Fallback opening info from static database
  const sanHistory = history.map((h) => h.san);
  const fallbackLookup = lookupPosition(sanHistory);

  // Fetch explorer data when position changes
  useEffect(() => {
    setExplorerLoading(true);
    const opts = explorerDb === "lichess" && ratingFilter.length > 0 ? { ratings: ratingFilter } : undefined;
    fetchExplorer(explorerDb, fen, opts).then((data) => {
      setExplorerData(data);
      setIsLive(data !== null);
      setExplorerLoading(false);
    });
  }, [fen, explorerDb, ratingFilter]);

  const makeMove = useCallback(
    (orig: Key, dest: Key) => {
      const uci = `${orig}${dest}`;
      const move = parseUci(uci);
      if (!move) return;

      const pos = position.clone();
      const san = makeSan(pos, move);
      pos.play(move);

      setPosition(pos);
      setHistory((h) => [...h, { san, uci, fen: makeFen(pos.toSetup()) }]);
    },
    [position],
  );

  const playExplorerMove = useCallback(
    (uci: string) => {
      const move = parseUci(uci);
      if (!move) return;

      const pos = position.clone();
      const san = makeSan(pos, move);
      pos.play(move);

      setPosition(pos);
      setHistory((h) => [...h, { san, uci, fen: makeFen(pos.toSetup()) }]);
    },
    [position],
  );

  const playBookMove = useCallback(
    (san: string) => {
      const move = parseSan(position, san);
      if (!move) return;

      const pos = position.clone();
      const uci = makeUci(move);
      pos.play(move);

      setPosition(pos);
      setHistory((h) => [...h, { san, uci, fen: makeFen(pos.toSetup()) }]);
    },
    [position],
  );

  function reset() {
    setPosition(Chess.default());
    setHistory([]);
  }

  function takeback() {
    if (history.length === 0) return;
    const newHistory = history.slice(0, -1);
    const pos = Chess.default();
    for (const entry of newHistory) {
      const move = parseUci(entry.uci);
      if (move) pos.play(move);
    }
    setPosition(pos);
    setHistory(newHistory);
  }

  // Opening name: prefer explorer data, fall back to static db
  const openingName = explorerData?.opening?.name ?? fallbackLookup.opening?.name ?? "Starting Position";
  const openingEco = explorerData?.opening?.eco ?? fallbackLookup.opening?.eco ?? "---";
  const moves = explorerData?.moves ?? [];
  const totalGames = explorerData ? explorerData.white + explorerData.draws + explorerData.black : 0;

  return (
    <div
      style={{
        display: "flex",
        gap: "2rem",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "flex-start",
      }}
    >
      {/* Board + controls */}
      <div style={{ flexShrink: 0 }}>
        <ChessgroundBoard
          fen={fen}
          orientation={orientation}
          turnColor={turnColor}
          onMove={makeMove}
          movable={{ free: false, dests, color: "both" }}
          lastMove={lastMove}
          check={isCheck}
        />

        {/* Controls */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={reset} style={uiBtnStyle}>
            Reset
          </button>
          <button onClick={takeback} style={uiBtnStyle} disabled={history.length === 0}>
            Takeback
          </button>
          <button
            onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
            style={uiBtnStyle}
          >
            Flip
          </button>
        </div>

        {/* Move history */}
        {history.length > 0 && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.5rem 0.75rem",
              background: "#131313",
              border: "1px solid #1a1a1a",
              borderRadius: "4px",
              fontSize: "0.8rem",
              color: "#aaa",
              fontFamily: "var(--font-headline)",
              letterSpacing: "0.02em",
              lineHeight: 1.8,
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {history.map((h, i) =>
              i % 2 === 0 ? (
                <span key={i}>
                  <span style={{ color: "#555" }}>{Math.floor(i / 2) + 1}.</span> {h.san}{" "}
                </span>
              ) : (
                <span key={i}>{h.san} </span>
              ),
            )}
          </div>
        )}
      </div>

      {/* Explorer panel */}
      <div style={{ flex: "1 1 280px", minWidth: "280px", maxWidth: "400px" }}>
        {/* Opening name */}
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#131313",
            border: `1px solid color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
            borderRadius: "4px",
            marginBottom: "1rem",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: ACCENT,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "0.25rem",
            }}
          >
            {openingEco}
          </div>
          <div style={{ fontFamily: "var(--font-headline)", fontSize: "0.95rem", fontWeight: 600 }}>
            {openingName}
          </div>
          {totalGames > 0 && (
            <>
              <div style={{ fontSize: "0.7rem", color: "#555", marginTop: "0.25rem" }}>
                {fmtCount(totalGames)} games
              </div>
              {/* Overall position win/draw/loss stats */}
              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  marginTop: "0.4rem",
                  fontSize: "0.65rem",
                  fontFamily: "var(--font-headline)",
                }}
              >
                <span style={{ color: "#e5e2e1" }}>
                  {pct(explorerData!.white, totalGames)}% white
                </span>
                <span style={{ color: "#777" }}>
                  {pct(explorerData!.draws, totalGames)}% draw
                </span>
                <span style={{ color: "#555" }}>
                  {pct(explorerData!.black, totalGames)}% black
                </span>
              </div>
            </>
          )}
        </div>

        {/* Database toggle */}
        <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem" }}>
          {(["masters", "lichess"] as const).map((db) => (
            <button
              key={db}
              onClick={() => setExplorerDb(db)}
              style={{
                ...uiBtnStyle,
                background: explorerDb === db ? ACCENT : "#131313",
                color: explorerDb === db ? "#0e0e0e" : ACCENT,
                fontWeight: explorerDb === db ? 700 : 400,
              }}
            >
              {db === "masters" ? "Masters" : "Lichess"}
            </button>
          ))}
        </div>

        {/* Rating filter (Lichess DB only) */}
        {explorerDb === "lichess" && (
          <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {[1600, 1800, 2000, 2200, 2500].map((r) => (
              <button
                key={r}
                onClick={() =>
                  setRatingFilter((f) => (f.includes(r) ? f.filter((x) => x !== r) : [...f, r]))
                }
                style={{
                  ...uiBtnStyle,
                  fontSize: "0.6rem",
                  padding: "0.25rem 0.5rem",
                  background: ratingFilter.includes(r) ? "rgba(6,182,212,0.15)" : "#131313",
                  borderColor: ratingFilter.includes(r) ? "rgba(6,182,212,0.4)" : "#1a1a1a",
                }}
              >
                {r}+
              </button>
            ))}
          </div>
        )}

        {/* Explorer moves header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-headline)",
            fontSize: "0.65rem",
            color: "#555",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "0.5rem",
          }}
        >
          <span>{explorerLoading ? "Loading..." : `Moves (${moves.length})`}</span>
          {!explorerLoading && (
            <span style={{ fontSize: "0.55rem", color: isLive ? "#22c55e" : "#555" }}>
              {isLive ? "live" : "offline"}
            </span>
          )}
        </div>

        {/* Explorer move rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2px",
            maxHeight: "calc(7 * 2.55rem)",
            overflowY: "auto",
          }}
        >
          {moves.map((m) => {
            const total = m.white + m.draws + m.black;
            const wp = total > 0 ? (m.white / total) * 100 : 0;
            const dp = total > 0 ? (m.draws / total) * 100 : 0;
            const bp = total > 0 ? (m.black / total) * 100 : 0;

            return (
              <button
                key={m.uci}
                onClick={() => playExplorerMove(m.uci)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.45rem 0.75rem",
                  background: "#131313",
                  border: "1px solid #1a1a1a",
                  borderRadius: "3px",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  color: "#e5e2e1",
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.85rem",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = `color-mix(in srgb, ${ACCENT} 50%, #1a1a1a)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#1a1a1a";
                }}
              >
                {/* Move name */}
                <span style={{ fontWeight: 700, minWidth: "3rem" }}>{m.san}</span>
                {/* Game count + percentages */}
                <span style={{ fontSize: "0.6rem", color: "#777", minWidth: "6rem" }}>
                  {fmtCount(total)}{" "}
                  <span style={{ color: "#555" }}>
                    ({pct(m.white, total)}/{pct(m.draws, total)}/{pct(m.black, total)})
                  </span>
                </span>
                {/* Win/draw/loss bar */}
                <div
                  style={{
                    flex: 1,
                    height: "6px",
                    borderRadius: "3px",
                    overflow: "hidden",
                    display: "flex",
                    background: "#1a1a1a",
                  }}
                >
                  <div style={{ width: `${wp}%`, background: "#e5e2e1" }} />
                  <div style={{ width: `${dp}%`, background: "#555" }} />
                  <div style={{ width: `${bp}%`, background: "#2a2a2a" }} />
                </div>
              </button>
            );
          })}
        </div>

        {/* Fallback: show static book moves if explorer has no data */}
        {moves.length === 0 && !explorerLoading && fallbackLookup.bookMoves.length > 0 && (
          <>
            <div
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "0.6rem",
                color: "#444",
                marginTop: "0.75rem",
                marginBottom: "0.25rem",
              }}
            >
              Offline book ({fallbackLookup.bookMoves.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {fallbackLookup.bookMoves.map((san) => (
                <button
                  key={san}
                  onClick={() => playBookMove(san)}
                  style={{
                    ...moveBtnStyle,
                    fontWeight: 700,
                    fontSize: "0.85rem",
                  }}
                >
                  {san}
                </button>
              ))}
            </div>
          </>
        )}

        {moves.length === 0 && !explorerLoading && fallbackLookup.bookMoves.length === 0 && (
          <p style={{ fontSize: "0.8rem", color: "#555", fontStyle: "italic" }}>
            {history.length === 0 ? "Make a move to begin." : "No data for this position."}
          </p>
        )}
      </div>
    </div>
  );
}

/* UI buttons (Reset, Takeback, Flip, db toggle, rating filter) — uppercase OK */
const uiBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.8rem",
  background: "#131313",
  color: ACCENT,
  border: `1px solid color-mix(in srgb, ${ACCENT} 30%, #1a1a1a)`,
  borderRadius: "3px",
  cursor: "pointer",
  transition: "background 0.15s, border-color 0.15s",
};

/* Move buttons — NO text-transform to preserve chess notation (Nf3, not NF3) */
const moveBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.05em",
  padding: "0.45rem 0.75rem",
  background: "#131313",
  color: ACCENT,
  border: "1px solid #1a1a1a",
  borderRadius: "3px",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
  transition: "border-color 0.15s",
};
