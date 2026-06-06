"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAudiobookPlayer } from "@/lib/audiobookPlayer";
import { chapterForChunk } from "@/lib/audiobookPlayerHelpers";
import { getAdminToken } from "@/lib/auth";

const ACCENT = "#94a3b8";

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function ListenClient({ slug }: { slug: string }) {
  const player = useAudiobookPlayer();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    if (player.slug === slug && player.manifest) return;
    const token = getAdminToken();
    if (!token) return;
    player.loadBook(slug).catch((e) => setBootError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (bootError) {
    return <Centered>{bootError}</Centered>;
  }
  if (!player.manifest) {
    return <Centered>loading…</Centered>;
  }

  const m = player.manifest;
  const chunk = m.chunks[player.currentChunkId];
  const currentChapter = chapterForChunk(m, player.currentChunkId);
  const chunkDuration = chunk?.duration_s ?? 0;
  const chunkPct = chunkDuration > 0 ? (player.progressInChunk / chunkDuration) * 100 : 0;

  const totalDuration = m.chunks.reduce((acc, c) => acc + c.duration_s, 0);
  const elapsedDuration =
    m.chunks.slice(0, player.currentChunkId).reduce((acc, c) => acc + c.duration_s, 0) +
    player.progressInChunk;
  const overallPct = totalDuration > 0 ? (elapsedDuration / totalDuration) * 100 : 0;

  return (
    <div
      style={{
        maxWidth: "60rem",
        margin: "0 auto",
        padding: "2rem 1.5rem 6rem",
        minHeight: "100vh",
        color: "#e5e2e1",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2rem" }}>
        <Link
          href="/reads"
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.7rem",
            color: ACCENT,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          ← back to reads
        </Link>
        <button
          onClick={player.close}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            color: "#666",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      <h1
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "1.6rem",
          letterSpacing: "-0.01em",
          marginBottom: "0.25rem",
        }}
      >
        {m.title}
      </h1>
      <p
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "0.8rem",
          color: "#888",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: "2rem",
        }}
      >
        {m.author} · narrated by {m.voice}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 240px) minmax(0, 1fr)",
          gap: "2rem",
          alignItems: "flex-start",
        }}
      >
        {/* Chapters */}
        <div
          style={{
            border: `1px solid color-mix(in srgb, ${ACCENT} 20%, #1a1a1a)`,
            borderRadius: "0.5rem",
            padding: "1rem",
            maxHeight: "60vh",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: ACCENT,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: "0.75rem",
            }}
          >
            {"// Chapters"}
          </div>
          {m.chapters.map((ch) => {
            const active = currentChapter?.id === ch.id;
            return (
              <button
                key={ch.id}
                onClick={() => player.seekToChunk(ch.chunk_start, 0)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  padding: "0.4rem 0.25rem",
                  fontSize: "0.8rem",
                  color: active ? "#e5e2e1" : "#888",
                  fontWeight: active ? 700 : 400,
                  cursor: "pointer",
                  borderLeft: `2px solid ${active ? ACCENT : "transparent"}`,
                  marginBottom: "0.15rem",
                }}
              >
                {ch.label}
              </button>
            );
          })}
        </div>

        {/* Now playing */}
        <div
          style={{
            background: "#131313",
            border: `1px solid color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
            borderLeft: `3px solid ${ACCENT}`,
            borderRadius: "0.5rem",
            padding: "1.5rem",
            position: "relative",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: ACCENT,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              marginBottom: "0.5rem",
            }}
          >
            Chunk {player.currentChunkId + 1} of {m.chunks.length}
            {currentChapter ? ` · ${currentChapter.label}` : ""}
          </div>

          <p
            style={{
              fontSize: "1rem",
              lineHeight: 1.7,
              color: "#d4d4d4",
              fontStyle: chunk?.kind?.endsWith("_bridge") ? "italic" : "normal",
              minHeight: "5rem",
              marginBottom: "1.5rem",
            }}
          >
            &ldquo;{chunk?.text ?? ""}&rdquo;
          </p>

          <div
            onClick={(e) => {
              if (chunkDuration <= 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              player.seekToChunk(player.currentChunkId, (x / rect.width) * chunkDuration);
            }}
            style={{
              height: "5px",
              background: "#2a2a2a",
              borderRadius: "2px",
              cursor: chunkDuration > 0 ? "pointer" : "default",
              marginBottom: "0.25rem",
              position: "relative",
            }}
          >
            <div
              style={{
                width: `${chunkPct}%`,
                height: "100%",
                background: ACCENT,
                borderRadius: "2px",
                transition: "width 0.2s linear",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.65rem",
              color: "#666",
              marginBottom: "1.25rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>{fmt(player.progressInChunk)}</span>
            <span>{fmt(chunkDuration)}</span>
          </div>

          <div style={{ height: "2px", background: "#1a1a1a", marginBottom: "0.25rem" }}>
            <div
              style={{
                width: `${overallPct}%`,
                height: "100%",
                background: `color-mix(in srgb, ${ACCENT} 60%, transparent)`,
                transition: "width 0.5s linear",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.6rem",
              color: "#555",
              marginBottom: "1.5rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>overall</span>
            <span>
              {fmt(elapsedDuration)} / {fmt(totalDuration)}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "1.25rem",
            }}
          >
            <span style={{ fontSize: "0.7rem", color: "#888" }}>speed</span>
            <input
              type="range"
              min="0.7"
              max="2.5"
              step="0.1"
              value={player.speed}
              onChange={(e) => player.setSpeed(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: ACCENT }}
            />
            <span style={{ fontSize: "0.7rem", color: "#e5e2e1", minWidth: "2.5rem" }}>
              {player.speed.toFixed(1)}×
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
            <ControlButton onClick={() => player.skipBack(15)} label="-15s" />
            <ControlButton
              onClick={() => (player.playing ? player.pause() : player.play())}
              label={player.playing ? "❚❚" : "▶"}
              big
            />
            <ControlButton onClick={() => player.skipForward(30)} label="+30s" />
            <ControlButton onClick={player.toggleMinimize} label="—" />
          </div>

          {player.error ? (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.5rem 0.75rem",
                border: "1px solid #f97316",
                borderRadius: "4px",
                color: "#f97316",
                fontSize: "0.75rem",
              }}
            >
              {player.error}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  big,
}: {
  onClick: () => void;
  label: string;
  big?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: `1px solid ${ACCENT}`,
        color: "#e5e2e1",
        fontFamily: "var(--font-headline)",
        fontSize: big ? "1rem" : "0.75rem",
        padding: big ? "0.5rem 1rem" : "0.4rem 0.75rem",
        cursor: "pointer",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        borderRadius: "2px",
      }}
    >
      {label}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#888",
        fontFamily: "var(--font-headline)",
        fontSize: "0.8rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}
