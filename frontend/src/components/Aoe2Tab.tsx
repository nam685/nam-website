"use client";

import { useEffect, useState } from "react";
import { API } from "@/lib/api";
import { store } from "@/lib/auth";
import {
  Aoe2MatchSummary,
  formatDuration,
  formatUptime,
  gameSharePath,
  openingColor,
  resultLabel,
} from "@/lib/aoe2";

const ACCENT = "var(--accent)";

type Stats = {
  total: number;
  wins: number;
  losses: number;
  favourite_civ: string | null;
  current_elo: number | null;
};

type Detail = Aoe2MatchSummary & {
  metrics: Record<string, unknown>;
  timeline: Record<string, unknown>;
  coach_analysis: string;
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
          const target = list.find((m) => m.id === param);
          setSelectedId(target ? target.id : list[0].id); // shared game if valid, else newest
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
                {m.my_civ} vs {m.opponent_civ}
              </span>
              <span style={{ color: "#777" }}>{m.map_name}</span>
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
              <span style={{ width: "4.5rem", textAlign: "right" }}>
                {resultLabel(m.my_result)}
              </span>
            </button>
            {selected && detail && detail.id === m.id && (
              <MatchDetail detail={detail} />
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

function MatchDetail({ detail }: { detail: Detail }) {
  const [copied, setCopied] = useState(false);

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

  const m = detail.metrics as Record<string, number | null | string>;
  const estimates: string[] =
    ((detail.metrics as Record<string, unknown>).estimates as string[]) || [];
  return (
    <div style={{ padding: "1rem 0 1.5rem" }}>
      <button onClick={copyShare} style={shareBtnStyle}>
        {copied ? "Copied!" : "Share"}
      </button>
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
          label="Idle TC (est)"
          value={`${m.idle_tc_est_s ?? 0}s`}
          estimate={estimates.includes("idle_tc_est_s")}
        />
        <Metric
          label="Length"
          value={formatDuration(detail.duration_seconds)}
        />
      </div>
      {detail.clip_url && (
        <iframe
          src={detail.clip_url}
          style={{
            width: "100%",
            maxWidth: "640px",
            aspectRatio: "16/9",
            border: "none",
          }}
          allowFullScreen
          title="clip"
        />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  estimate,
}: {
  label: string;
  value: string;
  estimate?: boolean;
}) {
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
        {estimate && <span style={{ color: "#b45309" }}> ~est</span>}
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

const shareBtnStyle: React.CSSProperties = {
  fontFamily: "var(--font-headline)",
  fontSize: "0.6rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  padding: "0.25rem 0.6rem",
  background: "transparent",
  color: "var(--accent)",
  border: "1px solid var(--accent)",
  borderRadius: "3px",
  cursor: "pointer",
  marginBottom: "0.75rem",
};
