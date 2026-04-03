"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { API } from "@/lib/api";
import type { LichessStatus } from "@/lib/api";
import { store } from "@/lib/auth";

const OpeningExplorer = dynamic(() => import("@/components/OpeningExplorer"), {
  ssr: false,
});
const LichessGame = dynamic(() => import("@/components/LichessGame"), {
  ssr: false,
});
const LichessGameCreator = dynamic(
  () => import("@/components/LichessGameCreator"),
  { ssr: false },
);

const ACCENT = "#06b6d4";

type Tab = "explorer" | "play";

export default function PlaysClient() {
  const [tab, setTab] = useState<Tab>("explorer");
  const [isAdmin, setIsAdmin] = useState(false);
  const [lichessStatus, setLichessStatus] = useState<LichessStatus | null>(
    null,
  );
  const [lichessToken, setLichessToken] = useState<string | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [myColor, setMyColor] = useState<"white" | "black">("white");

  // Check admin status
  useEffect(() => {
    const token = store("adminToken");
    if (!token) return;

    fetch(`${API}/api/auth/check/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.ok) setIsAdmin(true);
      })
      .catch(() => {});
  }, []);

  // Fetch Lichess connection status
  useEffect(() => {
    fetch(`${API}/api/lichess/status/`)
      .then((r) => r.json())
      .then((data: LichessStatus) => setLichessStatus(data))
      .catch(() => {});
  }, []);

  // Fetch Lichess token when admin switches to Play tab
  useEffect(() => {
    if (!isAdmin || tab !== "play") return;
    const adminToken = store("adminToken");
    if (!adminToken) return;

    fetch(`${API}/api/lichess/token/`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then((r) => {
        if (r.ok) return r.json();
        return null;
      })
      .then((data) => {
        if (data?.access_token) setLichessToken(data.access_token);
      })
      .catch(() => {});
  }, [isAdmin, tab]);

  function handleConnect() {
    const adminToken = store("adminToken");
    if (adminToken) {
      window.location.href = `${API}/api/lichess/auth/?token=${adminToken}`;
    }
  }

  async function handleDisconnect() {
    const adminToken = store("adminToken");
    if (!adminToken) return;
    const resp = await fetch(`${API}/api/lichess/disconnect/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (resp.ok) {
      setLichessStatus({ connected: false, username: null });
      setLichessToken(null);
    }
  }

  function handleGameStart(gameId: string, color: "white" | "black") {
    setActiveGameId(gameId);
    setMyColor(color);
  }

  function handleGameEnd() {
    setActiveGameId(null);
  }

  return (
    <div
      className="page"
      style={{ maxWidth: "72rem", position: "relative", zIndex: 1 }}
    >
      <h1>Plays</h1>
      <p>Explore chess openings with live data, or play a game on Lichess.</p>

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          marginTop: "1rem",
          marginBottom: "1.5rem",
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <button
          onClick={() => setTab("explorer")}
          style={{
            ...tabBtnStyle,
            borderBottomColor: tab === "explorer" ? ACCENT : "transparent",
            color: tab === "explorer" ? ACCENT : "#555",
          }}
        >
          Explorer
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab("play")}
            style={{
              ...tabBtnStyle,
              borderBottomColor: tab === "play" ? ACCENT : "transparent",
              color: tab === "play" ? ACCENT : "#555",
            }}
          >
            Play
            {lichessStatus?.connected && (
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#22c55e",
                  marginLeft: "0.4rem",
                }}
              />
            )}
          </button>
        )}
      </div>

      {/* Explorer tab */}
      {tab === "explorer" && <OpeningExplorer />}

      {/* Play tab */}
      {tab === "play" && isAdmin && (
        <>
          {/* Lichess connection status */}
          <div style={{ marginBottom: "1.5rem" }}>
            {lichessStatus?.connected ? (
              <span
                style={{
                  fontSize: "0.75rem",
                  color: "#aaa",
                  fontFamily: "var(--font-headline)",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#22c55e",
                    marginRight: "0.4rem",
                  }}
                />
                Connected as{" "}
                <span style={{ color: ACCENT }}>{lichessStatus.username}</span>
                <button
                  onClick={handleDisconnect}
                  style={{
                    marginLeft: "0.75rem",
                    fontFamily: "var(--font-headline)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#555",
                    background: "none",
                    border: "1px solid #333",
                    borderRadius: "3px",
                    padding: "0.2rem 0.5rem",
                    cursor: "pointer",
                  }}
                >
                  disconnect
                </button>
              </span>
            ) : (
              <button onClick={handleConnect} style={connectBtnStyle}>
                Connect Lichess
              </button>
            )}
          </div>

          {/* Game area */}
          {lichessToken ? (
            activeGameId ? (
              <LichessGame
                token={lichessToken}
                gameId={activeGameId}
                myColor={myColor}
                onGameEnd={handleGameEnd}
              />
            ) : (
              <LichessGameCreator
                token={lichessToken}
                onGameStart={handleGameStart}
              />
            )
          ) : (
            !lichessStatus?.connected && (
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "#555",
                  fontStyle: "italic",
                }}
              >
                Connect your Lichess account to play games.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

const tabBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  padding: "0.5rem 1rem",
  background: "transparent",
  border: "none",
  borderBottom: "2px solid transparent",
  cursor: "pointer",
  transition: "color 0.15s, border-color 0.15s",
};

const connectBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.8rem",
  background: "#06b6d4",
  color: "#0e0e0e",
  border: "none",
  borderRadius: "3px",
  cursor: "pointer",
  fontWeight: 700,
};
