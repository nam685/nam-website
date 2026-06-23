"use client";

import { useEffect, useRef, useState } from "react";
import { API } from "@/lib/api";
import { store } from "@/lib/auth";
import {
  Aoe2MatchSummary,
  Classifier,
  clipEmbedUrl,
  Economy,
  formatDuration,
  gameSharePath,
  MapGeometry,
  Mistake,
  openingColor,
  Reconstruction,
  resultLabel,
  stripCoachScaffolding,
} from "@/lib/aoe2";
import Aoe2BuildingMap from "./aoe2/Aoe2BuildingMap";
import Aoe2Classifier from "./aoe2/Aoe2Classifier";
import Aoe2EconomyTab from "./aoe2/Aoe2EconomyTab";
import Aoe2EfficiencyPanel from "./aoe2/Aoe2EfficiencyPanel";
import Aoe2Markdown from "./aoe2/Aoe2Markdown";
import Aoe2Mistakes from "./aoe2/Aoe2Mistakes";
import Aoe2ProductionChart from "./aoe2/Aoe2ProductionChart";

const ACCENT = "var(--accent)";

type Stats = {
  total: number;
  wins: number;
  losses: number;
  favourite_civ: string | null;
  current_elo: number | null;
  current_rank: number | null;
};

type Detail = Aoe2MatchSummary & {
  metrics: Record<string, unknown>;
  timeline: Record<string, unknown>;
  coach_analysis: string;
  coach_tier?: string;
  reconstruction?: Reconstruction;
  map_geometry?: MapGeometry;
  classifier?: Classifier;
  mistakes?: Mistake[];
  economy?: Economy;
  map_images?: string[];
  clip_title: string;
  clip_note: string;
  clip_start_seconds: number | null;
};

type TabKey = "coach" | "economy" | "military" | "review";
const TABS: { key: TabKey; label: string }[] = [
  { key: "coach", label: "Coach" },
  { key: "economy", label: "Economy" },
  { key: "military", label: "Military" },
  { key: "review", label: "Review" },
];

export default function Aoe2Tab() {
  const [matches, setMatches] = useState<Aoe2MatchSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<TabKey>("coach");

  useEffect(() => {
    fetch(`${API}/api/aoe2/`)
      .then((r) => r.json())
      .then((d) => {
        const list: Aoe2MatchSummary[] = d.matches || [];
        setMatches(list);
        if (list.length) {
          const param = Number(
            new URLSearchParams(window.location.search).get("game"),
          );
          const byParam = list.find((m) => m.id === param);
          const featured = list.find((m) => m.featured);
          const target = byParam ?? featured ?? list[0];
          setSelectedId(target.id);
        }
      })
      .catch(() => {});
    fetch(`${API}/api/aoe2/stats/`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
    const token = store("adminToken");
    if (token) {
      fetch(`${API}/api/auth/check/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.ok && setIsAdmin(true))
        .catch(() => {});
    }
  }, []);

  // Load detail for the selected game; reset to the Coach tab on a new game.
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    setTab("coach");
    fetch(`${API}/api/aoe2/${selectedId}/`)
      .then((r) => r.json())
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selectedId]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const token = store("adminToken");
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("rec", file);
      await fetch(`${API}/api/aoe2/upload/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).catch(() => {});
    }
    window.location.reload();
  }

  function refreshMatch(id: number) {
    fetch(`${API}/api/aoe2/${id}/`)
      .then((r) => r.json())
      .then((d: Detail) => {
        setDetail(d);
        setMatches((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  featured: d.featured,
                  clip_url: d.clip_url,
                  my_elo: d.my_elo,
                  my_rating_change: d.my_rating_change,
                }
              : m,
          ),
        );
      })
      .catch(() => {});
  }

  return (
    // Bump the whole Empires tab up a notch — the base text ran a touch small.
    // `zoom` scales the rem-based inline styles uniformly without rewriting each size.
    <div style={{ zoom: 1.1 }}>
      {/* Stats header */}
      {stats && (
        <div style={statsHeader}>
          <Stat label="ELO" value={stats.current_elo ?? "—"} />
          <Stat label="W / L" value={`${stats.wins} / ${stats.losses}`} />
        </div>
      )}

      {/* Admin upload */}
      {isAdmin && (
        <div style={{ marginBottom: "1rem" }}>
          <label style={uploadBtnStyle}>
            Upload .aoe2record
            <input
              type="file"
              accept=".aoe2record"
              multiple
              hidden
              onChange={handleUpload}
            />
          </label>
        </div>
      )}

      {matches.length === 0 ? (
        <p style={{ color: "#555", fontStyle: "italic", fontSize: "0.85rem" }}>
          No games yet.
        </p>
      ) : (
        /* Two-pane: selectable game list (left) + tabbed detail (right). */
        <div className="aoe2-shell">
          <aside className="aoe2-list">
            {matches.map((m) => {
              const sel = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedId(m.id)}
                  className="aoe2-list-row"
                  style={{
                    borderLeft: sel
                      ? `2px solid ${ACCENT}`
                      : "2px solid transparent",
                    background: sel ? "#0f1419" : "transparent",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    {m.featured && (
                      <span style={{ color: ACCENT, fontSize: "0.6rem" }}>
                        ★
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: "0.78rem",
                        color: sel ? ACCENT : "#ccc",
                        flex: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {m.my_civ} vs {m.opponent_civ}
                    </span>
                    <span
                      style={{
                        fontSize: "0.6rem",
                        color:
                          m.my_result === "win"
                            ? "#22c55e"
                            : m.my_result === "loss"
                              ? "#ef4444"
                              : "#888",
                      }}
                    >
                      {resultLabel(m.my_result)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                      marginTop: "0.2rem",
                    }}
                  >
                    <span style={{ fontSize: "0.6rem", color: "#777" }}>
                      {m.map_name}
                    </span>
                    {m.opening && (
                      <span
                        style={{
                          fontSize: "0.55rem",
                          padding: "0.05rem 0.3rem",
                          borderRadius: "3px",
                          background: openingColor(m.opening),
                          color: "#0e0e0e",
                        }}
                      >
                        {m.opening}
                      </span>
                    )}
                    {m.my_rating_change != null && (
                      <span
                        style={{
                          fontSize: "0.6rem",
                          marginLeft: "auto",
                          color:
                            m.my_rating_change > 0
                              ? "#22c55e"
                              : m.my_rating_change < 0
                                ? "#ef4444"
                                : "#888",
                        }}
                      >
                        {m.my_rating_change > 0 ? "+" : ""}
                        {m.my_rating_change}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </aside>

          <div className="aoe2-detail">
            {detail && detail.id === selectedId ? (
              <MatchDetail
                detail={detail}
                tab={tab}
                onTab={setTab}
                isAdmin={isAdmin}
                onRefresh={() => refreshMatch(detail.id)}
              />
            ) : (
              <p style={{ color: "#555", fontSize: "0.8rem" }}>Loading…</p>
            )}
            {detail && detail.id === selectedId && (
              <p
                style={{
                  marginTop: "1.25rem",
                  fontSize: "0.6rem",
                  color: "#4a4a4a",
                  fontStyle: "italic",
                }}
              >
                Best-effort reconstruction from the replay command log — some
                details (unit kills/losses, live counts, map vision) can&apos;t
                be recovered.
              </p>
            )}
          </div>
        </div>
      )}

      <style>{`
        .aoe2-shell { display: flex; gap: 1rem; align-items: flex-start; }
        .aoe2-list {
          width: 240px; flex-shrink: 0; max-height: 78vh; overflow-y: auto;
          border-right: 1px solid #1a1a1a; padding-right: 0.5rem;
          display: flex; flex-direction: column; gap: 1px;
        }
        .aoe2-list-row {
          width: 100%; text-align: left; background: transparent; border: none;
          cursor: pointer; padding: 0.5rem 0.6rem; display: block;
        }
        .aoe2-list-row:hover { background: #0d1117 !important; }
        .aoe2-detail { flex: 1; min-width: 0; }
        @media (max-width: 720px) {
          .aoe2-shell { flex-direction: column; }
          .aoe2-list {
            width: 100%; flex-direction: row; max-height: none; overflow-x: auto;
            border-right: none; border-bottom: 1px solid #1a1a1a;
            padding-right: 0; padding-bottom: 0.5rem;
          }
          .aoe2-list-row { min-width: 200px; }
        }
      `}</style>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={statLabel}>{label}</div>
      <div style={{ fontSize: "1.3rem", color: ACCENT, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function MatchDetail({
  detail,
  tab,
  onTab,
  isAdmin,
  onRefresh,
}: {
  detail: Detail;
  tab: TabKey;
  onTab: (next: TabKey) => void;
  isAdmin: boolean;
  onRefresh: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clipFormOpen, setClipFormOpen] = useState(false);
  const [clipUrl, setClipUrl] = useState(detail.clip_url || "");
  const [clipTitle, setClipTitle] = useState(detail.clip_title || "");
  const [clipNote, setClipNote] = useState(detail.clip_note || "");
  const [clipStart, setClipStart] = useState(
    detail.clip_start_seconds != null ? String(detail.clip_start_seconds) : "",
  );
  const [clipSaving, setClipSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(
        window.location.origin + gameSharePath(detail.id),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function toggleFeature() {
    setMenuOpen(false);
    const token = store("adminToken");
    await fetch(`${API}/api/aoe2/${detail.id}/feature/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    onRefresh();
  }

  async function saveClip() {
    setClipSaving(true);
    const token = store("adminToken");
    await fetch(`${API}/api/aoe2/${detail.id}/clip/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: clipUrl,
        title: clipTitle,
        note: clipNote,
        start_seconds: clipStart !== "" ? Number(clipStart) : null,
      }),
    }).catch(() => {});
    setClipSaving(false);
    setClipFormOpen(false);
    onRefresh();
  }

  return (
    <div>
      {/* Tab bar + admin menu */}
      <div style={tabBar}>
        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onTab(t.key)}
              style={{
                ...tabBtn,
                color: tab === t.key ? "#0e0e0e" : "#aaa",
                background: tab === t.key ? ACCENT : "transparent",
                borderColor: tab === t.key ? ACCENT : "#2a2a2a",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More"
            style={dotsBtnStyle}
          >
            ⋮
          </button>
          {menuOpen && (
            <div ref={menuRef} style={menuStyle}>
              <button onClick={copyShare} style={menuItemStyle}>
                {copied ? "Copied!" : "Share link"}
              </button>
              {isAdmin && (
                <>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setClipFormOpen((o) => !o);
                    }}
                    style={menuItemStyle}
                  >
                    {detail.clip_url ? "Edit clip" : "Attach clip"}
                  </button>
                  <button onClick={toggleFeature} style={menuItemStyle}>
                    {detail.featured ? "Unfeature" : "Feature"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Admin clip form */}
      {isAdmin && clipFormOpen && (
        <div style={clipForm}>
          <input
            type="url"
            placeholder="YouTube or Twitch URL"
            value={clipUrl}
            onChange={(e) => setClipUrl(e.target.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Title (optional)"
            value={clipTitle}
            onChange={(e) => setClipTitle(e.target.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Note (optional)"
            value={clipNote}
            onChange={(e) => setClipNote(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            placeholder="Start seconds (optional)"
            value={clipStart}
            onChange={(e) => setClipStart(e.target.value)}
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={saveClip}
              disabled={clipSaving}
              style={{ ...uploadBtnStyle, fontSize: "0.65rem" }}
            >
              {clipSaving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setClipFormOpen(false)}
              style={{
                ...uploadBtnStyle,
                background: "transparent",
                color: "#888",
                border: "1px solid #333",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tab content — sized to fit without scrolling on desktop. */}
      <div style={{ animation: "fadeIn 0.25s ease both" }}>
        {tab === "coach" && <CoachTab detail={detail} />}
        {tab === "economy" && <Aoe2EconomyTab economy={detail.economy} />}
        {tab === "military" && <MilitaryTab detail={detail} />}
        {tab === "review" && <ReviewTab detail={detail} />}
      </div>
    </div>
  );
}

/* ── Coach (default) — the headline: verdict + minimap + basic stats ── */
function CoachTab({ detail }: { detail: Detail }) {
  const coachText = stripCoachScaffolding(detail.coach_analysis);
  const m = detail.metrics as Record<string, number | null | string>;
  const recon = detail.reconstruction;
  const meta = recon?.meta as Record<string, unknown> | undefined;
  const ages = recon?.ages ?? {};
  const eff = recon?.efficiency ?? {};

  const basics: { label: string; value: string }[] = [
    { label: "Result", value: resultLabel(detail.my_result) },
    {
      label: "Matchup",
      value: `${detail.my_civ} vs ${detail.opponent_civ}`,
    },
    { label: "Map", value: detail.map_name || "—" },
    { label: "Length", value: formatDuration(detail.duration_seconds) },
    {
      label: "Feudal",
      value: fmtAge(ages["feudal_arrival_s"]),
    },
    { label: "Castle", value: fmtAge(ages["castle_arrival_s"]) },
    { label: "Imperial", value: fmtAge(ages["imperial_arrival_s"]) },
    {
      label: "APM",
      value:
        eff.apm_total != null ? String(eff.apm_total) : String(m.apm ?? "—"),
    },
  ];
  if (detail.my_elo != null)
    basics.push({ label: "ELO", value: String(detail.my_elo) });
  if (meta?.opp_rating != null)
    basics.push({ label: "Opp ELO", value: String(meta.opp_rating) });

  const embedUrl = detail.clip_url
    ? clipEmbedUrl(
        detail.clip_url,
        typeof window !== "undefined" ? window.location.hostname : "localhost",
      )
    : null;

  return (
    <div style={{ display: "flex", gap: "1.25rem", flexWrap: "wrap" }}>
      {/* Left: build-order guess + verdict */}
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        {detail.classifier?.candidates?.length ? (
          <div style={{ marginBottom: "0.75rem" }}>
            <span style={sectionLabel}>Likely build</span>
            <Aoe2Classifier classifier={detail.classifier} />
          </div>
        ) : null}
        {coachText ? (
          <Aoe2Markdown source={coachText} />
        ) : (
          <p style={{ fontSize: "0.8rem", color: "#666", fontStyle: "italic" }}>
            No coach analysis for this match yet.
          </p>
        )}
      </div>

      {/* Right: strategic minimap + basic stats grid */}
      <div style={{ flex: "0 0 340px", maxWidth: "100%" }}>
        {detail.map_geometry && (
          <Aoe2BuildingMap geometry={detail.map_geometry} />
        )}
        <div style={basicsGrid}>
          {basics.map((b) => (
            <div key={b.label}>
              <div style={statLabel}>{b.label}</div>
              <div style={{ fontSize: "0.85rem", color: "#ddd" }}>
                {b.value}
              </div>
            </div>
          ))}
        </div>
        {embedUrl && (
          <div style={{ marginTop: "0.75rem" }}>
            {detail.clip_title && (
              <div
                style={{
                  fontSize: "0.65rem",
                  color: "#888",
                  marginBottom: "0.25rem",
                }}
              >
                {detail.clip_title}
              </div>
            )}
            <iframe
              src={embedUrl}
              style={{ width: "100%", aspectRatio: "16/9", border: "none" }}
              allowFullScreen
              title={detail.clip_title || "clip"}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Military — the unified full-width production graph (areas above, upgrade/unit
   icon row below, age lines). Build-order guess now lives on the Coach tab. ── */
function MilitaryTab({ detail }: { detail: Detail }) {
  const recon = detail.reconstruction;
  if (!recon) return <Empty />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      {/* Unified full-width production graph (areas + event icon row + age lines) */}
      <Aoe2ProductionChart recon={recon} />
    </div>
  );
}

/* ── Review — the efficiency stats (TC idle, longest villager gap, APM split) ABOVE
   the mistakes list. The summative "how did I play" tab. ── */
function ReviewTab({ detail }: { detail: Detail }) {
  const recon = detail.reconstruction;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      {recon && (
        <div>
          <div style={sectionLabel}>Stats</div>
          <Aoe2EfficiencyPanel recon={recon} />
        </div>
      )}
      <div>
        <div style={sectionLabel}>Mistakes</div>
        <Aoe2Mistakes mistakes={detail.mistakes ?? []} />
      </div>
    </div>
  );
}

function Empty() {
  return (
    <p style={{ fontSize: "0.8rem", color: "#666", fontStyle: "italic" }}>
      No reconstruction data for this match.
    </p>
  );
}

function fmtAge(v: unknown): string {
  if (typeof v !== "number" || v <= 0) return "—";
  const s = Math.floor(v);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ── styles ── */
const statsHeader: React.CSSProperties = {
  display: "flex",
  gap: "2.5rem",
  marginBottom: "1rem",
  flexWrap: "wrap",
  justifyContent: "center",
  textAlign: "center",
};
const statLabel: React.CSSProperties = {
  fontSize: "0.55rem",
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const sectionLabel: React.CSSProperties = {
  fontSize: "0.55rem",
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  marginBottom: "0.4rem",
  display: "block",
};
const basicsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))",
  gap: "0.6rem 0.9rem",
  marginTop: "0.75rem",
};
const tabBar: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid #1a1a1a",
  paddingBottom: "0.6rem",
  marginBottom: "1rem",
  gap: "0.5rem",
};
const tabBtn: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.62rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  padding: "0.3rem 0.6rem",
  border: "1px solid",
  borderRadius: "3px",
  cursor: "pointer",
  fontWeight: 600,
};
const uploadBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.7rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.4rem 0.8rem",
  background: ACCENT,
  color: "#0e0e0e",
  border: "none",
  borderRadius: "3px",
  cursor: "pointer",
  fontWeight: 700,
};
const dotsBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  fontSize: "1.2rem",
  lineHeight: 1,
  cursor: "pointer",
  padding: "0.1rem 0.4rem",
};
const menuStyle: React.CSSProperties = {
  position: "absolute",
  top: "1.6rem",
  right: 0,
  background: "#0e0e0e",
  border: "1px solid #2a2a2a",
  borderRadius: "4px",
  padding: "0.25rem",
  zIndex: 10,
};
const menuItemStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.65rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: ACCENT,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
  padding: "0.3rem 0.6rem",
  display: "block",
  width: "100%",
  textAlign: "left",
};
const clipForm: React.CSSProperties = {
  background: "#111",
  border: "1px solid #2a2a2a",
  borderRadius: "4px",
  padding: "0.75rem",
  marginBottom: "1rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};
const inputStyle: React.CSSProperties = {
  background: "#0a0a0a",
  border: "1px solid #2a2a2a",
  borderRadius: "3px",
  color: "#ccc",
  padding: "0.3rem 0.5rem",
  fontSize: "0.75rem",
  width: "100%",
  boxSizing: "border-box",
};
