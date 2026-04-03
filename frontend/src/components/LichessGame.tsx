"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { parseUci } from "chessops/util";
import { chessgroundDests } from "chessops/compat";
import type { Key, Color } from "chessground/types";
import ChessgroundBoard from "./ChessgroundBoard";
import {
  parseNdJsonStream,
  streamBoardGame,
  sendMove,
  resignGame,
  abortGame,
  offerDraw,
} from "@/lib/lichessApi";

const ACCENT = "#06b6d4";

interface Player {
  name: string;
  rating: number;
}

interface GameState {
  moves: string; // space-separated UCI
  wtime: number;
  btime: number;
  winc: number;
  binc: number;
  status: string;
  winner?: string;
  wdraw?: boolean;
  bdraw?: boolean;
}

interface Props {
  token: string;
  gameId: string;
  myColor: Color;
  onGameEnd: () => void;
}

export default function LichessGame({ token, gameId, myColor, onGameEnd }: Props) {
  const [position, setPosition] = useState<Chess>(Chess.default());
  const [moveList, setMoveList] = useState<string[]>([]);
  const [lastMove, setLastMove] = useState<[Key, Key] | undefined>();
  const [whitePlayer, setWhitePlayer] = useState<Player | null>(null);
  const [blackPlayer, setBlackPlayer] = useState<Player | null>(null);
  const [wtime, setWtime] = useState(0);
  const [btime, setBtime] = useState(0);
  const [status, setStatus] = useState("Connecting...");
  const [gameOver, setGameOver] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const turnColor = position.turn === "white" ? "white" : "black";
  const isMyTurn = turnColor === myColor;
  const fen = makeFen(position.toSetup());
  const dests = isMyTurn ? chessgroundDests(position) : new Map();
  const isCheck = position.isCheck();

  // Apply a moves string (space-separated UCI) to build current position
  const applyMoves = useCallback((movesStr: string) => {
    const ucis = movesStr.trim() ? movesStr.trim().split(" ") : [];
    const pos = Chess.default();
    const moves: string[] = [];
    let last: [Key, Key] | undefined;

    for (const uci of ucis) {
      const move = parseUci(uci);
      if (move) {
        pos.play(move);
        moves.push(uci);
        last = [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key];
      }
    }

    setPosition(pos);
    setMoveList(moves);
    setLastMove(last);
  }, []);

  // Stream the game
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    (async () => {
      try {
        const resp = await streamBoardGame(token, gameId);
        if (!resp.body) return;

        await parseNdJsonStream(resp.body, (event: Record<string, unknown>) => {
          if (event.type === "gameFull") {
            // Initial full game state
            const wp = event.white as Record<string, unknown> | undefined;
            const bp = event.black as Record<string, unknown> | undefined;
            if (wp)
              setWhitePlayer({
                name: (wp.name ?? wp.id ?? "?") as string,
                rating: (wp.rating ?? 0) as number,
              });
            if (bp)
              setBlackPlayer({
                name: (bp.name ?? bp.id ?? "?") as string,
                rating: (bp.rating ?? 0) as number,
              });

            const state = event.state as GameState;
            applyMoves(state.moves);
            setWtime(state.wtime);
            setBtime(state.btime);
            updateStatus(state);
          } else if (event.type === "gameState") {
            const state = event as unknown as GameState;
            applyMoves(state.moves);
            setWtime(state.wtime);
            setBtime(state.btime);
            updateStatus(state);
          }
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setStatus("Connection lost");
        }
      }
    })();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, gameId, applyMoves]);

  function updateStatus(state: GameState) {
    if (state.status === "started" || state.status === "created") {
      setStatus("");
      setGameOver(false);
    } else {
      const result =
        state.winner === myColor ? "You won!" : state.winner ? "You lost." : "Draw.";
      setStatus(`Game over — ${result} (${state.status})`);
      setGameOver(true);
    }
  }

  async function handleMove(orig: Key, dest: Key) {
    const uci = `${orig}${dest}`;
    // Optimistically apply
    applyMoves([...moveList, uci].join(" "));
    // Send to Lichess
    const resp = await sendMove(token, gameId, uci);
    if (!resp.ok) {
      // Revert on failure — stream will send correct state
      applyMoves(moveList.join(" "));
    }
  }

  function formatTime(ms: number): string {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  const topPlayer = myColor === "white" ? blackPlayer : whitePlayer;
  const bottomPlayer = myColor === "white" ? whitePlayer : blackPlayer;
  const topTime = myColor === "white" ? btime : wtime;
  const bottomTime = myColor === "white" ? wtime : btime;

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
      {/* Board + clocks */}
      <div style={{ flexShrink: 0 }}>
        {/* Top player + clock */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
          <span style={{ fontFamily: "var(--font-headline)", fontSize: "0.8rem", color: "#aaa" }}>
            {topPlayer ? `${topPlayer.name} (${topPlayer.rating})` : "Opponent"}
          </span>
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: turnColor !== myColor ? ACCENT : "#555",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(topTime)}
          </span>
        </div>

        <ChessgroundBoard
          fen={fen}
          orientation={myColor}
          turnColor={turnColor}
          onMove={handleMove}
          movable={{ free: false, dests, color: isMyTurn ? myColor : undefined }}
          lastMove={lastMove}
          check={isCheck}
          premovable={true}
          viewOnly={gameOver}
        />

        {/* Bottom player + clock */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.5rem" }}>
          <span style={{ fontFamily: "var(--font-headline)", fontSize: "0.8rem", color: "#aaa" }}>
            {bottomPlayer ? `${bottomPlayer.name} (${bottomPlayer.rating})` : "You"}
          </span>
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: turnColor === myColor ? ACCENT : "#555",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatTime(bottomTime)}
          </span>
        </div>

        {/* Status */}
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

      {/* Game actions panel */}
      <div style={{ flex: "1 1 200px", minWidth: "200px", maxWidth: "280px" }}>
        {!gameOver && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {moveList.length < 2 && (
              <button onClick={() => abortGame(token, gameId)} style={btnStyle}>
                Abort
              </button>
            )}
            <button onClick={() => resignGame(token, gameId)} style={btnStyle}>
              Resign
            </button>
            <button onClick={() => offerDraw(token, gameId, "yes")} style={btnStyle}>
              Offer Draw
            </button>
          </div>
        )}

        {gameOver && (
          <button
            onClick={onGameEnd}
            style={{ ...btnStyle, background: ACCENT, color: "#0e0e0e", fontWeight: 700 }}
          >
            New Game
          </button>
        )}

        {/* Move history */}
        {moveList.length > 0 && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.5rem 0.75rem",
              background: "#131313",
              border: "1px solid #1a1a1a",
              borderRadius: "4px",
              fontSize: "0.75rem",
              color: "#aaa",
              fontFamily: "var(--font-headline)",
              lineHeight: 1.8,
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {moveList.map((uci, i) =>
              i % 2 === 0 ? (
                <span key={i}>
                  <span style={{ color: "#555" }}>{Math.floor(i / 2) + 1}.</span> {uci}{" "}
                </span>
              ) : (
                <span key={i}>{uci} </span>
              ),
            )}
          </div>
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
  padding: "0.5rem 1rem",
  background: "#131313",
  color: ACCENT,
  border: `1px solid color-mix(in srgb, ${ACCENT} 30%, #1a1a1a)`,
  borderRadius: "3px",
  cursor: "pointer",
  transition: "background 0.15s",
  width: "100%",
};
