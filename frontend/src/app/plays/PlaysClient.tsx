"use client";

import dynamic from "next/dynamic";

const ChessTrainer = dynamic(() => import("@/components/ChessTrainer"), { ssr: false });

export default function PlaysClient() {
  return (
    <div className="page" style={{ maxWidth: "72rem", position: "relative", zIndex: 1 }}>
      <h1>Plays</h1>
      <p>Practice chess openings — play moves and explore book lines.</p>
      <div style={{ marginTop: "1.5rem" }}>
        <ChessTrainer />
      </div>
    </div>
  );
}
