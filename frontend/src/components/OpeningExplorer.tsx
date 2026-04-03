"use client";

import { useState, useCallback, useEffect } from "react";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";
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

export default function OpeningExplorer() {
  const [position, setPosition] = useState<Chess>(Chess.default());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [orientation, setOrientation] = useState<"white" | "black">("white");
  const [explorerDb, setExplorerDb] = useState<ExplorerDb>("masters");
  const [explorerData, setExplorerData] = useState<ExplorerResponse | null>(null);
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [ratingFilter, setRatingFilter] = useState<number[]>([]);

  const fen = makeFen(position.toSetup());
  const turnColor = position.turn === "white" ? "white" : "black";
  const lastMove = history.length > 0 ? (history[history.length - 1].uci.match(/.{2}/g) as [Key, Key]) : undefined;
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

  function reset() {
    setPosition(Chess.default());
    setHistory([]);
  }

  function takeback() {
    if (history.length === 0) return;
    const newHistory = history.slice(0, -1);
    // Rebuild position from scratch
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
          <button onClick={reset} style={btnStyle}>
            Reset
          </button>
          <button onClick={takeback} style={btnStyle} disabled={history.length === 0}>
            Takeback
          </button>
          <button onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))} style={btnStyle}>
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
            <div style={{ fontSize: "0.7rem", color: "#555", marginTop: "0.25rem" }}>
              {totalGames.toLocaleString()} games
            </div>
          )}
        </div>

        {/* Database toggle */}
        <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem" }}>
          {(["masters", "lichess"] as const).map((db) => (
            <button
              key={db}
              onClick={() => setExplorerDb(db)}
              style={{
                ...btnStyle,
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
                  ...btnStyle,
                  fontSize: "0.6rem",
                  padding: "0.25rem 0.5rem",
                  background: ratingFilter.includes(r) ? "rgba(6,182,212,0.15)" : "#131313",
                  borderColor: ratingFilter.includes(r)
                    ? "rgba(6,182,212,0.4)"
                    : "#1a1a1a",
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
            fontFamily: "var(--font-headline)",
            fontSize: "0.65rem",
            color: "#555",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "0.5rem",
          }}
        >
          {explorerLoading ? "Loading..." : `Moves (${moves.length})`}
        </div>

        {/* Explorer move rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
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
                {/* Game count */}
                <span style={{ fontSize: "0.65rem", color: "#777", minWidth: "4rem" }}>
                  {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : total}
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
                  onClick={() => {
                    /* Would need SAN->UCI conversion -- skip for offline fallback.
                       Users can just click the board. */
                  }}
                  style={{
                    ...btnStyle,
                    width: "100%",
                    textAlign: "left",
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

const btnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
  padding: "0.4rem 0.8rem",
  background: "#131313",
  color: ACCENT,
  border: `1px solid color-mix(in srgb, ${ACCENT} 30%, #1a1a1a)`,
  borderRadius: "3px",
  cursor: "pointer",
  transition: "background 0.15s, border-color 0.15s",
};
