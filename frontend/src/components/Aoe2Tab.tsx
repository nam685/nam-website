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
  formatUptime,
  gameSharePath,
  MapGeometry,
  Mistake,
  openingColor,
  Reconstruction,
  resultLabel,
  sanitizeCoachText,
} from "@/lib/aoe2";
import Aoe2BuildingMap from "./aoe2/Aoe2BuildingMap";
import Aoe2Classifier from "./aoe2/Aoe2Classifier";
import Aoe2EconomyChart from "./aoe2/Aoe2EconomyChart";
import Aoe2EfficiencyPanel from "./aoe2/Aoe2EfficiencyPanel";
import Aoe2Markdown from "./aoe2/Aoe2Markdown";
import Aoe2Mistakes from "./aoe2/Aoe2Mistakes";
import Aoe2ProducedStrip from "./aoe2/Aoe2ProducedStrip";
import Aoe2Timeline from "./aoe2/Aoe2Timeline";

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
  // aoe2coach v2 rich data (optional → old matches degrade to the flat metric tiles).
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

export default function Aoe2Tab() {
  const [matches, setMatches] = useState<Aoe2MatchSummary[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

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
          // Precedence: ?game= > featured > newest
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

  // Load detail only for the selected (expanded) game.
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
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
    // Re-fetch the specific match in the list + its detail.
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
    <div>
      {/* Stats header */}
      {stats && (
        <div
          style={{
            display: "flex",
            gap: "1.5rem",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          <Stat label="ELO" value={stats.current_elo ?? "—"} />
          {stats.current_rank && (
            <Stat label="Rank" value={`#${stats.current_rank}`} />
          )}
          <Stat label="W / L" value={`${stats.wins} / ${stats.losses}`} />
          <Stat label="Games" value={stats.total} />
          <Stat label="Top civ" value={stats.favourite_civ ?? "—"} />
        </div>
      )}

      {/* Admin upload */}
      {isAdmin && (
        <div style={{ marginBottom: "1.5rem" }}>
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

      {/* Accordion match list */}
      {matches.length === 0 && (
        <p style={{ color: "#555", fontStyle: "italic", fontSize: "0.85rem" }}>
          No games yet.
        </p>
      )}
      {matches.map((m) => {
        const selected = m.id === selectedId;
        return (
          <div key={m.id} style={{ borderBottom: "1px solid #1a1a1a" }}>
            <button
              onClick={() => setSelectedId(selected ? null : m.id)}
              style={{ ...rowStyle, color: selected ? ACCENT : "#ccc" }}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                {m.featured && (
                  <span
                    style={{
                      display: "inline-block",
                      marginRight: "0.35rem",
                      color: ACCENT,
                      fontSize: "0.6rem",
                    }}
                    title="Featured"
                  >
                    ★
                  </span>
                )}
                {m.my_civ} vs {m.opponent_civ}
              </span>
              <span style={{ color: "#777" }}>{m.map_name}</span>
              {m.opening && (
                <span
                  style={{
                    fontSize: "0.6rem",
                    padding: "0.1rem 0.4rem",
                    borderRadius: "3px",
                    background: openingColor(m.opening),
                    color: "#0e0e0e",
                  }}
                >
                  {m.opening}
                </span>
              )}
              {m.my_rating_change !== null &&
                m.my_rating_change !== undefined && (
                  <span
                    style={{
                      fontSize: "0.65rem",
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
              <span style={{ width: "4.5rem", textAlign: "right" }}>
                {resultLabel(m.my_result)}
              </span>
            </button>
            {selected && detail && detail.id === m.id && (
              <MatchDetail
                detail={detail}
                isAdmin={isAdmin}
                onRefresh={() => refreshMatch(m.id)}
              />
            )}
          </div>
        );
      })}

      <div style={{ textAlign: "center", marginTop: "3rem" }}>
        <span style={taglineStyle}>built different — analyzed differently</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.6rem",
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </div>
      <div
        style={{ fontSize: "1.4rem", color: "var(--accent)", fontWeight: 700 }}
      >
        {value}
      </div>
    </div>
  );
}

function MatchDetail({
  detail,
  isAdmin,
  onRefresh,
}: {
  detail: Detail;
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
    detail.clip_start_seconds !== null &&
      detail.clip_start_seconds !== undefined
      ? String(detail.clip_start_seconds)
      : "",
  );
  const [clipSaving, setClipSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click.
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
      // clipboard unavailable — ignore
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

  const m = detail.metrics as Record<string, number | null | string>;

  // Convert stored watch URL to embed URL for the iframe.
  const embedUrl = detail.clip_url
    ? clipEmbedUrl(
        detail.clip_url,
        typeof window !== "undefined" ? window.location.hostname : "localhost",
      )
    : null;

  return (
    <div style={{ padding: "1rem 0 1.5rem" }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
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

      {/* Admin clip form */}
      {isAdmin && clipFormOpen && (
        <div
          style={{
            background: "#111",
            border: "1px solid #2a2a2a",
            borderRadius: "4px",
            padding: "0.75rem",
            marginBottom: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
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

      {detail.featured && (
        <div
          style={{
            fontSize: "0.6rem",
            color: "var(--accent)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: "0.5rem",
          }}
        >
          ★ Featured game
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <Metric
          label="Feudal"
          value={formatUptime(m.feudal_uptime_s as number | null)}
        />
        <Metric
          label="Castle"
          value={formatUptime(m.castle_uptime_s as number | null)}
        />
        <Metric
          label="Imperial"
          value={formatUptime(m.imperial_uptime_s as number | null)}
        />
        <Metric label="APM" value={String(m.apm ?? "—")} />
        <Metric label="Villagers" value={String(m.villager_count ?? "—")} />
        <Metric
          label="Length"
          value={formatDuration(detail.duration_seconds)}
        />
        {detail.my_elo !== null && detail.my_elo !== undefined && (
          <Metric label="ELO after" value={String(detail.my_elo)} />
        )}
      </div>

      {/* aoe2coach v2 visualization panels (#5). Lazy-mounted with the selected match; each guards
          its own data so an old match (no reconstruction) simply shows the metric tiles + coach. */}
      <Aoe2Viz detail={detail} />

      {(() => {
        const coach = sanitizeCoachText(detail.coach_analysis);
        if (!coach) return null;
        return (
          <div style={{ marginTop: "1.5rem" }}>
            <div
              style={{
                fontSize: "0.55rem",
                color: "#666",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: "0.5rem",
              }}
            >
              Coach
            </div>
            <div
              style={{
                fontSize: "0.8rem",
                color: "#bbb",
                lineHeight: 1.7,
                borderLeft: "2px solid var(--accent)",
                paddingLeft: "0.75rem",
              }}
            >
              <Aoe2Markdown text={coach} />
            </div>
          </div>
        );
      })()}

      {embedUrl && (
        <div style={{ marginTop: "0.75rem" }}>
          {detail.clip_title && (
            <div
              style={{
                fontSize: "0.7rem",
                color: "#888",
                marginBottom: "0.3rem",
              }}
            >
              {detail.clip_title}
            </div>
          )}
          <iframe
            src={embedUrl}
            style={{
              width: "100%",
              maxWidth: "640px",
              aspectRatio: "16/9",
              border: "none",
            }}
            allowFullScreen
            title={detail.clip_title || "clip"}
          />
          {detail.clip_note && (
            <div
              style={{
                fontSize: "0.65rem",
                color: "#666",
                marginTop: "0.3rem",
              }}
            >
              {detail.clip_note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VizSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: "1.25rem", animation: "fadeUp 0.4s ease both" }}>
      <div
        style={{
          fontSize: "0.55rem",
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: "0.5rem",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Aoe2Viz({ detail }: { detail: Detail }) {
  const recon = detail.reconstruction;
  const geo = detail.map_geometry;
  const hasRecon = !!recon && Object.keys(recon).length > 0;
  const hasGeo =
    !!geo &&
    ((geo.me?.buildings?.length ?? 0) > 0 ||
      (geo.opp?.buildings?.length ?? 0) > 0 ||
      !!geo.me?.base_centroid);
  const candidates = detail.classifier?.candidates ?? [];

  // Nothing rich to show (an old, pre-v2 match) → render nothing; the metric tiles + coach stand.
  if (!hasRecon && !hasGeo && candidates.length === 0) return null;

  return (
    <div>
      {hasGeo && (
        <VizSection title="Strategic map">
          <Aoe2BuildingMap geometry={geo!} />
        </VizSection>
      )}

      {candidates.length > 0 && (
        <VizSection title="Build order">
          <Aoe2Classifier classifier={detail.classifier!} />
        </VizSection>
      )}

      {hasRecon && (
        <>
          <VizSection title="Timeline">
            <Aoe2Timeline recon={recon!} />
          </VizSection>

          <VizSection title="Efficiency">
            <Aoe2EfficiencyPanel
              recon={recon!}
              durationS={detail.duration_seconds}
            />
          </VizSection>

          <VizSection title="Mistakes">
            <Aoe2Mistakes mistakes={detail.mistakes ?? []} />
          </VizSection>

          <VizSection title="Economy">
            <Aoe2EconomyChart economy={detail.economy} />
          </VizSection>

          <VizSection title="Produced counts">
            <Aoe2ProducedStrip recon={recon!} />
          </VizSection>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.55rem",
          color: "#666",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "1rem", color: "#ddd" }}>{value}</div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  width: "100%",
  padding: "0.7rem 0.25rem",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: "0.8rem",
};

const uploadBtnStyle: React.CSSProperties = {
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

const taglineStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.6rem",
  color: "#2a2a2a",
  letterSpacing: "0.2em",
  textTransform: "lowercase",
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
  color: "var(--accent)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
  padding: "0.3rem 0.6rem",
  display: "block",
  width: "100%",
  textAlign: "left",
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
