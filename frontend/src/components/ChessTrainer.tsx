"use client";

import { useState, useCallback } from "react";
import { Chess, type Move } from "chess.js";
import { Chessboard } from "react-chessboard";
import { lookupPosition } from "@/lib/chessOpenings";

const ACCENT = "#06b6d4";

type Side = "white" | "black";

export default function ChessTrainer() {
  const [game, setGame] = useState(new Chess());
  const [trainingSide, setTrainingSide] = useState<Side>("white");
  const [history, setHistory] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  const lookup = lookupPosition(history);

  const makeMove = useCallback(
    (move: string | { from: string; to: string; promotion?: string }) => {
      const g = new Chess(game.fen());
      let result: Move | null;
      try {
        result = g.move(move);
      } catch {
        return null;
      }
      if (!result) return null;

      const newHistory = [...history, result.san];
      setGame(g);
      setHistory(newHistory);

      // Check if this move is in book
      const wasInBook = lookup.bookMoves.includes(result.san);
      if (!wasInBook && history.length > 0) {
        setStatus("You went off book! Keep going or reset.");
      } else {
        setStatus("");
      }

      // Auto-respond for the opponent using book moves
      const isOurTurn =
        (trainingSide === "white" && g.turn() === "w") || (trainingSide === "black" && g.turn() === "b");

      if (!isOurTurn && !g.isGameOver()) {
        const opponentLookup = lookupPosition(newHistory);
        if (opponentLookup.bookMoves.length > 0) {
          // Pick a random book move for the opponent
          const pick = opponentLookup.bookMoves[Math.floor(Math.random() * opponentLookup.bookMoves.length)];
          setTimeout(() => {
            const g2 = new Chess(g.fen());
            const r2 = g2.move(pick);
            if (r2) {
              setGame(g2);
              setHistory((h) => [...h, r2.san]);
            }
          }, 300);
        } else {
          setStatus("Opponent is out of book!");
        }
      }

      return result;
    },
    [game, trainingSide, history, lookup.bookMoves],
  );

  function onDrop({
    sourceSquare,
    targetSquare,
  }: {
    piece: { isSparePiece: boolean; position: string; pieceType: string };
    sourceSquare: string;
    targetSquare: string | null;
  }) {
    if (!targetSquare) return false;
    const result = makeMove({ from: sourceSquare, to: targetSquare, promotion: "q" });
    return result !== null;
  }

  function reset() {
    setGame(new Chess());
    setHistory([]);
    setStatus("");
  }

  function takeback() {
    const g = new Chess(game.fen());
    g.undo();
    g.undo();
    setGame(g);
    setHistory((h) => h.slice(0, -2));
    setStatus("");
  }

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
      {/* Board */}
      <div style={{ width: "min(400px, 90vw)", flexShrink: 0 }}>
        <Chessboard
          options={{
            position: game.fen(),
            onPieceDrop: onDrop,
            boardOrientation: trainingSide,
            darkSquareStyle: { backgroundColor: "#164e63" },
            lightSquareStyle: { backgroundColor: "#1e293b" },
            boardStyle: {
              borderRadius: "4px",
              border: `1px solid color-mix(in srgb, ${ACCENT} 30%, #1a1a1a)`,
            },
          }}
        />

        {/* Controls */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={reset} style={btnStyle}>
            Reset
          </button>
          <button onClick={takeback} style={btnStyle} disabled={history.length < 2}>
            Takeback
          </button>
          <button
            onClick={() => {
              setTrainingSide((s) => (s === "white" ? "black" : "white"));
              reset();
            }}
            style={btnStyle}
          >
            Flip (play {trainingSide === "white" ? "black" : "white"})
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
            {history.map((m, i) =>
              i % 2 === 0 ? (
                <span key={i}>
                  <span style={{ color: "#555" }}>{Math.floor(i / 2) + 1}.</span> {m}{" "}
                </span>
              ) : (
                <span key={i}>{m} </span>
              ),
            )}
          </div>
        )}

        {status && (
          <p
            style={{
              marginTop: "0.5rem",
              fontSize: "0.8rem",
              color: ACCENT,
              fontFamily: "var(--font-headline)",
            }}
          >
            {status}
          </p>
        )}
      </div>

      {/* Opening info + book moves panel */}
      <div style={{ flex: "1 1 260px", minWidth: "260px", maxWidth: "360px" }}>
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
            {lookup.opening ? lookup.opening.eco : "---"}
          </div>
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.95rem",
              fontWeight: 600,
            }}
          >
            {lookup.opening ? lookup.opening.name : "Starting Position"}
          </div>
        </div>

        {/* Book moves */}
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
          Book moves ({lookup.bookMoves.length})
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {lookup.bookMoves.map((san) => (
            <button
              key={san}
              onClick={() => makeMove(san)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 0.75rem",
                background: "#131313",
                border: "1px solid #1a1a1a",
                borderRadius: "3px",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                color: "#e5e2e1",
                fontFamily: "var(--font-headline)",
                fontSize: "0.9rem",
                fontWeight: 700,
                transition: "border-color 0.15s, background 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = `color-mix(in srgb, ${ACCENT} 50%, #1a1a1a)`;
                e.currentTarget.style.background = "#1a1a1a";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#1a1a1a";
                e.currentTarget.style.background = "#131313";
              }}
            >
              {san}
            </button>
          ))}
        </div>

        {lookup.bookMoves.length === 0 && (
          <p style={{ fontSize: "0.8rem", color: "#555", fontStyle: "italic" }}>
            {history.length === 0 ? "Make a move to begin." : "End of book lines."}
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
  textTransform: "uppercase",
  padding: "0.4rem 0.8rem",
  background: "#131313",
  color: ACCENT,
  border: `1px solid color-mix(in srgb, ${ACCENT} 30%, #1a1a1a)`,
  borderRadius: "3px",
  cursor: "pointer",
  transition: "background 0.15s",
};
