// frontend/src/components/AudiobookPill.tsx
"use client";

import { useRouter } from "next/navigation";
import { useAudiobookPlayer } from "@/lib/audiobookPlayer";

export default function AudiobookPill() {
  const { slug, manifest, playing, visible, minimized, play, pause } =
    useAudiobookPlayer();
  const router = useRouter();

  if (!visible || !minimized || !slug) return null;

  const title = manifest?.title ?? "audiobook";

  return (
    <div
      onClick={() => router.push(`/reads/${slug}/listen`)}
      style={{
        position: "fixed",
        bottom: "5.5rem",
        right: "1.5rem",
        zIndex: 141,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 14px 6px 10px",
        background: "rgba(14, 14, 14, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid #2a2a2a",
        borderRadius: "24px",
        cursor: "pointer",
        animation: "fadeIn 0.2s ease-out",
        maxWidth: "260px",
      }}
    >
      <span style={{ fontSize: "16px", lineHeight: 1 }}>📖</span>
      <span
        style={{
          fontFamily: "var(--font-headline)",
          color: "#e5e2e1",
          fontSize: "11px",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          flex: 1,
        }}
      >
        {title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          playing ? pause() : play();
        }}
        style={{
          background: "none",
          border: "none",
          color: "#e5e2e1",
          fontSize: "13px",
          cursor: "pointer",
          padding: "0 2px",
          lineHeight: 1,
        }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
    </div>
  );
}
