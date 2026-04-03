"use client";

import { useRef, useEffect } from "react";
import { Chessground } from "chessground";
import type { Api as CgApi } from "chessground/api";
import type { Config } from "chessground/config";
import type { Key, Color } from "chessground/types";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./ChessgroundBoard.css";

export interface ChessgroundBoardProps {
  fen: string;
  orientation: Color;
  turnColor: Color;
  onMove?: (orig: Key, dest: Key) => void;
  movable?: {
    free: boolean;
    dests?: Map<Key, Key[]>;
    color?: Color | "both";
  };
  lastMove?: [Key, Key];
  check?: Key | boolean;
  premovable?: boolean;
  viewOnly?: boolean;
}

export default function ChessgroundBoard({
  fen,
  orientation,
  turnColor,
  onMove,
  movable,
  lastMove,
  check,
  premovable = false,
  viewOnly = false,
}: ChessgroundBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<CgApi | null>(null);

  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  // Create Chessground on mount
  useEffect(() => {
    if (!boardRef.current) return;

    const config: Config = {
      fen,
      orientation,
      turnColor,
      coordinates: true,
      movable: {
        free: movable?.free ?? false,
        color: movable?.color ?? turnColor,
        dests: movable?.dests,
        showDests: true,
      },
      lastMove: lastMove ? [lastMove[0], lastMove[1]] : undefined,
      check: check ?? false,
      premovable: { enabled: premovable },
      viewOnly,
      animation: { enabled: true, duration: 150 },
      events: {
        move: (orig: Key, dest: Key) => {
          onMoveRef.current?.(orig, dest);
        },
      },
    };

    const cg = Chessground(boardRef.current, config);
    cgRef.current = cg;

    return () => {
      cg.destroy();
      cgRef.current = null;
    };
    // Only run on mount — updates handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update Chessground on prop changes
  useEffect(() => {
    if (!cgRef.current) return;
    cgRef.current.set({
      fen,
      orientation,
      turnColor,
      movable: {
        free: movable?.free ?? false,
        color: movable?.color ?? turnColor,
        dests: movable?.dests,
        showDests: true,
      },
      lastMove: lastMove ? [lastMove[0], lastMove[1]] : undefined,
      check: check ?? false,
      premovable: { enabled: premovable },
      viewOnly,
    });
  }, [
    fen,
    orientation,
    turnColor,
    movable,
    lastMove,
    check,
    premovable,
    viewOnly,
  ]);

  return (
    <div
      ref={boardRef}
      style={{
        width: "min(400px, 90vw)",
        aspectRatio: "1",
        border: "1px solid color-mix(in srgb, #06b6d4 30%, #1a1a1a)",
        borderRadius: "4px",
      }}
    />
  );
}
