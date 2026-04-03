"use client";

import { useState, useRef, useEffect } from "react";
import {
  challengePlayer,
  createOpenChallenge,
  seekOpponent,
  parseNdJsonStream,
  streamEvents,
} from "@/lib/lichessApi";

const ACCENT = "#06b6d4";

type GameMode = "challenge" | "open" | "seek";

const TIME_PRESETS = [
  { label: "10+0", limit: 600, increment: 0 },
  { label: "15+10", limit: 900, increment: 10 },
  { label: "30+0", limit: 1800, increment: 0 },
];

interface Props {
  token: string;
  onGameStart: (gameId: string, myColor: "white" | "black") => void;
}

export default function LichessGameCreator({ token, onGameStart }: Props) {
  const [mode, setMode] = useState<GameMode>("challenge");
  const [username, setUsername] = useState("");
  const [timePreset, setTimePreset] = useState(0);
  const [customLimit, setCustomLimit] = useState(600);
  const [customIncrement, setCustomIncrement] = useState(0);
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [color, setColor] = useState<"white" | "black" | "random">("random");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openChallengeUrl, setOpenChallengeUrl] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Abort any open streams on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const clock = useCustomTime
    ? { limit: customLimit, increment: customIncrement }
    : { limit: TIME_PRESETS[timePreset].limit, increment: TIME_PRESETS[timePreset].increment };

  async function waitForGameStart(signal: AbortSignal): Promise<void> {
    const resp = await streamEvents(token, signal);
    if (!resp.ok) {
      throw new Error(`Event stream failed (${resp.status})`);
    }
    if (!resp.body) {
      throw new Error("No event stream body");
    }

    return new Promise((resolve, reject) => {
      parseNdJsonStream(resp.body!, (event: Record<string, unknown>) => {
        if (event.type === "gameStart") {
          const game = event.game as Record<string, unknown>;
          const gameId = game.gameId ?? game.id;
          const myColor = (game.color ?? "white") as "white" | "black";
          onGameStart(gameId as string, myColor);
          resolve();
        }
      }).catch((err) => {
        if (signal.aborted) resolve(); // swallow abort errors
        else reject(err);
      });
    });
  }

  async function handleCreate() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    setOpenChallengeUrl("");

    try {
      if (mode === "challenge") {
        if (!username.trim()) {
          setError("Enter a username");
          setLoading(false);
          return;
        }
        const resp = await challengePlayer(token, username.trim(), {
          clock,
          color,
          rated: false,
        });
        if (!resp.ok) {
          const body = await resp.json().catch(() => null);
          setError(body?.error ?? `Failed (${resp.status})`);
          setLoading(false);
          return;
        }
        await waitForGameStart(controller.signal);
      } else if (mode === "open") {
        const resp = await createOpenChallenge(token, { clock, rated: false });
        if (!resp.ok) {
          setError("Failed to create open challenge");
          setLoading(false);
          return;
        }
        const data = await resp.json();
        setOpenChallengeUrl(data.challenge?.url ?? data.url ?? "");
        await waitForGameStart(controller.signal);
      } else {
        // Fire the seek, then listen on the event stream for gameStart
        const seekResp = await seekOpponent(
          token,
          {
            time: clock.limit,
            increment: clock.increment,
            rated: false,
          },
          controller.signal,
        );
        if (!seekResp.ok) {
          const body = await seekResp.json().catch(() => null);
          setError(body?.error ?? `Seek failed (${seekResp.status})`);
          setLoading(false);
          return;
        }
        await waitForGameStart(controller.signal);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Connection failed");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: "400px",
        margin: "0 auto",
        padding: "1.5rem",
        background: "#131313",
        border: `1px solid color-mix(in srgb, ${ACCENT} 20%, #1a1a1a)`,
        borderRadius: "4px",
      }}
    >
      {/* Mode tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.25rem" }}>
        {(
          [
            ["challenge", "Challenge"],
            ["open", "Open"],
            ["seek", "Find"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              ...tabStyle,
              borderColor: mode === m ? ACCENT : "transparent",
              color: mode === m ? ACCENT : "#555",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Challenge-specific: username */}
      {mode === "challenge" && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={labelStyle}>Opponent username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="lichess username"
            style={inputStyle}
          />
        </div>
      )}

      {/* Time control */}
      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Time control</label>
        <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.5rem" }}>
          {TIME_PRESETS.map((p, i) => (
            <button
              key={p.label}
              onClick={() => {
                setTimePreset(i);
                setUseCustomTime(false);
              }}
              style={{
                ...tabStyle,
                borderColor: !useCustomTime && timePreset === i ? ACCENT : "#1a1a1a",
                color: !useCustomTime && timePreset === i ? ACCENT : "#777",
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setUseCustomTime(true)}
            style={{
              ...tabStyle,
              borderColor: useCustomTime ? ACCENT : "#1a1a1a",
              color: useCustomTime ? ACCENT : "#777",
            }}
          >
            Custom
          </button>
        </div>
        {useCustomTime && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <div>
              <label style={{ ...labelStyle, fontSize: "0.55rem" }}>Minutes</label>
              <input
                type="number"
                min={1}
                max={180}
                value={customLimit / 60}
                onChange={(e) => setCustomLimit(Number(e.target.value) * 60)}
                style={{ ...inputStyle, width: "4rem" }}
              />
            </div>
            <div>
              <label style={{ ...labelStyle, fontSize: "0.55rem" }}>Increment (s)</label>
              <input
                type="number"
                min={0}
                max={60}
                value={customIncrement}
                onChange={(e) => setCustomIncrement(Number(e.target.value))}
                style={{ ...inputStyle, width: "4rem" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Color (for challenge mode) */}
      {mode === "challenge" && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={labelStyle}>Play as</label>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            {(["random", "white", "black"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  ...tabStyle,
                  borderColor: color === c ? ACCENT : "#1a1a1a",
                  color: color === c ? ACCENT : "#777",
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create / Cancel button */}
      {loading ? (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div
            style={{
              ...tabStyle,
              flex: 1,
              padding: "0.6rem",
              background: "#1a1a1a",
              color: "#555",
              fontWeight: 700,
              borderColor: ACCENT,
              textAlign: "center",
            }}
          >
            Waiting for opponent...
          </div>
          <button
            onClick={() => {
              abortRef.current?.abort();
              setLoading(false);
            }}
            style={{
              ...tabStyle,
              padding: "0.6rem 1rem",
              background: "transparent",
              color: "#ef4444",
              fontWeight: 700,
              borderColor: "#ef4444",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={handleCreate}
          style={{
            ...tabStyle,
            width: "100%",
            padding: "0.6rem",
            background: ACCENT,
            color: "#0e0e0e",
            fontWeight: 700,
            borderColor: ACCENT,
            cursor: "pointer",
          }}
        >
          Create Game
        </button>
      )}

      {/* Open challenge URL */}
      {openChallengeUrl && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "0.5rem",
            background: "#0e0e0e",
            borderRadius: "3px",
            fontSize: "0.7rem",
            color: "#aaa",
            wordBreak: "break-all",
          }}
        >
          Share this link:{" "}
          <a
            href={openChallengeUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: ACCENT }}
          >
            {openChallengeUrl}
          </a>
        </div>
      )}

      {/* Error */}
      {error && (
        <p style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#ef4444" }}>{error}</p>
      )}
    </div>
  );
}

const tabStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.65rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.75rem",
  background: "transparent",
  border: "1px solid transparent",
  borderBottom: "2px solid transparent",
  borderRadius: "3px",
  cursor: "pointer",
  transition: "color 0.15s, border-color 0.15s",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.6rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "#555",
  display: "block",
  marginBottom: "0.3rem",
};

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.85rem",
  padding: "0.4rem 0.6rem",
  background: "#0e0e0e",
  color: "#e5e2e1",
  border: "1px solid #1a1a1a",
  borderRadius: "3px",
  outline: "none",
  width: "100%",
};
