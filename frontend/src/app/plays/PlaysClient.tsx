"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { API } from "@/lib/api";
import type { LichessStatus } from "@/lib/api";
import { fetchAdminNonce, store, useIsAdmin } from "@/lib/auth";

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
const Aoe2Tab = dynamic(() => import("@/components/Aoe2Tab"), { ssr: false });

const ACCENT = "var(--accent)";

type Tab = "explorer" | "play" | "empires";
/** Which game this page is showing — reflected in the URL path (/plays/<section>). */
export type PlaysSection = "chess" | "aoe2";

export default function PlaysClient({
  section = "chess",
}: {
  section?: PlaysSection;
}) {
  const router = useRouter();
  // The chess sub-tab (Explorer / Play). For aoe2, `tab` is "empires".
  const [tab, setTab] = useState<Tab>(
    section === "aoe2" ? "empires" : "explorer",
  );
  const isAdmin = useIsAdmin();
  const [lichessStatus, setLichessStatus] = useState<LichessStatus | null>(
    null,
  );
  const [lichessToken, setLichessToken] = useState<string | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [myColor, setMyColor] = useState<"white" | "black">("white");

  // Keep the active sub-tab in sync with the route section.
  useEffect(() => {
    setTab(section === "aoe2" ? "empires" : "explorer");
  }, [section]);

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

  async function handleConnect() {
    const nonce = await fetchAdminNonce();
    if (nonce) {
      window.location.href = `${API}/api/lichess/auth/?nonce=${encodeURIComponent(nonce)}`;
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
      style={{
        // The page (and the chess|AoE2 selector) always spans the full width — the
        // selector must stay 100% wide for both games. Chess *content* is re-constrained
        // to a comfortable reading column below; AoE2's two-pane uses the full width.
        maxWidth: "none",
        // Pull the game selector up close to the top nav (no extra gap).
        paddingTop: "0.5rem",
        position: "relative",
        zIndex: 1,
      }}
    >
      {/* Top-level game selector: chess | AoE 2 — spans the full content width,
          and the active game is reflected in the URL path (/plays/chess|aoe2). */}
      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          borderBottom: "1px solid #1a1a1a",
        }}
      >
        <button
          onClick={() => router.push("/plays/chess")}
          style={{
            ...tabBtnStyle,
            flex: 1,
            borderBottomColor: section === "chess" ? ACCENT : "transparent",
            color: section === "chess" ? ACCENT : "#555",
          }}
        >
          chess
        </button>
        <button
          onClick={() => router.push("/plays/aoe2")}
          style={{
            ...tabBtnStyle,
            flex: 1,
            borderBottomColor: section === "aoe2" ? ACCENT : "transparent",
            color: section === "aoe2" ? ACCENT : "#555",
          }}
        >
          AoE 2
        </button>
      </div>

      {/* Chess content is re-constrained to a comfortable reading column (the
          full-width selector above stays 100% wide for both games). */}
      <div
        style={
          section === "chess"
            ? { maxWidth: "72rem", marginInline: "auto" }
            : undefined
        }
      >
        {/* Secondary bar: Explorer | Play (only when chess is active) */}
        {section === "chess" && (
          <div
            style={{
              display: "flex",
              gap: "0.25rem",
              marginBottom: "1.5rem",
              borderBottom: "1px solid #111",
            }}
          >
            <button
              onClick={() => setTab("explorer")}
              style={{
                ...secondaryTabBtnStyle,
                borderBottomColor: tab === "explorer" ? ACCENT : "transparent",
                color: tab === "explorer" ? ACCENT : "#444",
              }}
            >
              Explorer
            </button>
            {isAdmin && (
              <button
                onClick={() => setTab("play")}
                style={{
                  ...secondaryTabBtnStyle,
                  borderBottomColor: tab === "play" ? ACCENT : "transparent",
                  color: tab === "play" ? ACCENT : "#444",
                }}
              >
                Play
                {lichessStatus?.connected && (
                  <span
                    style={{
                      display: "inline-block",
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: "#22c55e",
                      marginLeft: "0.35rem",
                    }}
                  />
                )}
              </button>
            )}
          </div>
        )}
        {section === "aoe2" && <div style={{ marginBottom: "1.5rem" }} />}

        {/* Explorer tab */}
        {section === "chess" && tab === "explorer" && <OpeningExplorer />}

        {/* Empires tab */}
        {section === "aoe2" && <Aoe2Tab />}

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
                  <span style={{ color: ACCENT }}>
                    {lichessStatus.username}
                  </span>
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

      {/* Tagline */}
      <div style={{ textAlign: "center", marginTop: "3rem" }}>
        <span
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.6rem",
            color: "#2a2a2a",
            letterSpacing: "0.2em",
            textTransform: "lowercase",
          }}
        >
          i spent waaay too much time on this
        </span>
      </div>
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

const secondaryTabBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.6rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.35rem 0.75rem",
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
  background: "var(--accent)",
  color: "#0e0e0e",
  border: "none",
  borderRadius: "3px",
  cursor: "pointer",
  fontWeight: 700,
};
