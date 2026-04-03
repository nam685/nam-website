"use client";

import { useRouter } from "next/navigation";
import { usePlayer } from "@/lib/player";
import { useBreakpoint } from "@/lib/useBreakpoint";

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MiniPlayer() {
  const {
    queue,
    currentIndex,
    playing,
    progress,
    duration,
    shuffle,
    repeat,
    visible,
    minimized,
    pause,
    resume,
    next,
    prev,
    seek,
    toggleShuffle,
    cycleRepeat,
    toggleMinimize,
    close,
  } = usePlayer();
  const router = useRouter();
  const bp = useBreakpoint();
  const isMobile = bp === "mobile";

  if (!visible) return null;

  const track =
    currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : null;
  if (!track) return null;

  const pct = duration > 0 ? (progress / duration) * 100 : 0;

  /* ── Minimized pill view ───────────────────────────────── */

  if (minimized) {
    return (
      <div
        onClick={() => router.push("/listens")}
        style={{
          position: "fixed",
          bottom: "5rem",
          right: "1.5rem",
          zIndex: 140,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "4px 12px 4px 4px",
          background: "rgba(14, 14, 14, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid #2a2a2a",
          borderRadius: "24px",
          cursor: "pointer",
          animation: "fadeIn 0.2s ease-out",
        }}
      >
        <img
          src={track.thumbnail_url}
          alt=""
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            objectFit: "cover",
          }}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            playing ? pause() : resume();
          }}
          style={{
            background: "none",
            border: "none",
            color: "#e5e2e1",
            fontSize: "14px",
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

  /* ── Full view ─────────────────────────────────────────── */

  return (
    <div
      style={{
        position: "fixed",
        bottom: isMobile ? 0 : "5rem",
        right: isMobile ? 0 : "1.5rem",
        left: isMobile ? 0 : "auto",
        zIndex: 140,
        width: isMobile ? "100%" : 280,
        background: "rgba(14, 14, 14, 0.85)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid #2a2a2a",
        borderRadius: isMobile ? 0 : 12,
        padding: "12px",
        fontFamily: "var(--font-body)",
        animation: "fadeIn 0.2s ease-out",
      }}
    >
      {/* Header: track info + minimize/close */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          marginBottom: "10px",
        }}
      >
        <div
          onClick={() => router.push("/listens")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flex: 1,
            minWidth: 0,
            cursor: "pointer",
          }}
        >
          <img
            src={track.thumbnail_url}
            alt=""
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "6px",
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                color: "#e5e2e1",
                fontSize: "12px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.3,
              }}
            >
              {track.title}
            </div>
            <div
              style={{
                color: "#888",
                fontSize: "11px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: 1.3,
              }}
            >
              {track.artist}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: "2px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={toggleMinimize}
            title="Minimize"
            style={{
              background: "none",
              border: "none",
              color: "#666",
              fontSize: "14px",
              cursor: "pointer",
              padding: "2px 4px",
              lineHeight: 1,
            }}
          >
            ─
          </button>
          <button
            onClick={close}
            title="Close"
            style={{
              background: "none",
              border: "none",
              color: "#666",
              fontSize: "14px",
              cursor: "pointer",
              padding: "2px 4px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: "8px" }}>
        <div
          onClick={(e) => {
            if (duration <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const fraction = x / rect.width;
            seek(fraction * duration);
          }}
          style={{
            width: "100%",
            height: "4px",
            background: "#2a2a2a",
            borderRadius: "2px",
            cursor: duration > 0 ? "pointer" : "default",
            position: "relative",
            marginBottom: "4px",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "#f97316",
              borderRadius: "2px",
              transition: "width 0.3s linear",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "9px",
            color: "#666",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Controls row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
        }}
      >
        {/* Shuffle */}
        <button
          onClick={toggleShuffle}
          title={shuffle ? "Shuffle on" : "Shuffle off"}
          style={{
            background: "none",
            border: "none",
            color: shuffle ? "#f97316" : "#666",
            fontSize: "14px",
            cursor: "pointer",
            padding: "4px",
            lineHeight: 1,
            transition: "color 0.15s",
          }}
        >
          ⇌
        </button>

        {/* Prev */}
        <button
          onClick={prev}
          title="Previous"
          style={{
            background: "none",
            border: "none",
            color: "#e5e2e1",
            fontSize: "14px",
            cursor: "pointer",
            padding: "4px",
            lineHeight: 1,
          }}
        >
          ⏮
        </button>

        {/* Play/Pause */}
        <button
          onClick={playing ? pause : resume}
          title={playing ? "Pause" : "Play"}
          style={{
            background: "none",
            border: "none",
            color: "#e5e2e1",
            fontSize: "20px",
            cursor: "pointer",
            padding: "4px 6px",
            lineHeight: 1,
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>

        {/* Next */}
        <button
          onClick={next}
          title="Next"
          style={{
            background: "none",
            border: "none",
            color: "#e5e2e1",
            fontSize: "14px",
            cursor: "pointer",
            padding: "4px",
            lineHeight: 1,
          }}
        >
          ⏭
        </button>

        {/* Repeat */}
        <button
          onClick={cycleRepeat}
          title={`Repeat: ${repeat}`}
          style={{
            background: "none",
            border: "none",
            color: repeat !== "off" ? "#f97316" : "#666",
            fontSize: "14px",
            cursor: "pointer",
            padding: "4px",
            lineHeight: 1,
            transition: "color 0.15s",
            position: "relative",
          }}
        >
          ⟳
          {repeat === "one" && (
            <span
              style={{
                position: "absolute",
                top: "-2px",
                right: "-2px",
                fontSize: "8px",
                fontWeight: 700,
                color: "#f97316",
                lineHeight: 1,
              }}
            >
              1
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
