"use client";

import { useEffect, useState } from "react";

import { API } from "@/lib/api";
import { store } from "@/lib/auth";
import { getContribColor } from "@/lib/contributions";
import { formatRelativeDate } from "@/lib/date";
import { CyberGrid, HexDecorations } from "@/components/CyberGrid";

/* ── Data ──────────────────────────────────────────── */

interface CodeProject {
  title: string;
  slug: string;
  description: string;
  tags: string[];
  status: "active" | "wip" | "archived";
  github_url: string;
  live_url: string;
}

const PROJECTS: CodeProject[] = [
  {
    title: "nam-website",
    slug: "nam-website",
    description:
      "This website. Django + Next.js with a cyberpunk theme, deployed to Hetzner VPS via GitHub Actions.",
    tags: ["django", "next.js", "typescript", "caddy"],
    status: "active",
    github_url: "https://github.com/nam685/nam-website",
    live_url: "https://nam685.de",
  },
  {
    title: "klaude",
    slug: "klaude",
    description:
      "DIY AI coding agent built from scratch. Claude-powered CLI tool for autonomous development.",
    tags: ["python", "ai", "agent", "claude"],
    status: "wip",
    github_url: "https://github.com/nam685/klaude",
    live_url: "",
  },
];

const ACCENT = "#22c55e";

const STATUS_LABEL: Record<string, string> = {
  active: "LIVE",
  wip: "WIP",
  archived: "ARCHIVED",
};

/* ── Types for GitHub contribution data ──────────── */

interface ContributionDay {
  contributionCount: number;
  date: string;
}

interface ContributionWeek {
  contributionDays: ContributionDay[];
}

interface ContributionCalendar {
  totalContributions: number;
  weeks: ContributionWeek[];
}

/* ── Project card ────────────────────────────────── */

function ProjectCard({
  project,
  pushedAt,
}: {
  project: CodeProject;
  pushedAt?: string;
}) {
  return (
    <div
      className="code-card"
      style={{
        background: "#131313",
        border: `1px solid color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
        borderLeft: `3px solid ${ACCENT}`,
        borderRadius: "0.5rem",
        padding: "1.5rem",
        position: "relative",
        overflow: "hidden",
        flex: "1 1 340px",
        minWidth: 0,
      }}
    >
      {/* Corner bracket — top right */}
      <div
        style={{
          position: "absolute",
          top: -1,
          right: -1,
          width: "14px",
          height: "14px",
          borderTop: `2px solid ${ACCENT}`,
          borderRight: `2px solid ${ACCENT}`,
        }}
      />

      {/* Header: title + status */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.75rem",
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "1.15rem",
            fontWeight: 700,
            color: "#e5e2e1",
            letterSpacing: "-0.01em",
          }}
        >
          {project.title}
        </h3>
        <span
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.6rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: project.status === "active" ? ACCENT : "#555",
            border: `1px solid ${project.status === "active" ? ACCENT : "#333"}`,
            padding: "0.15rem 0.4rem",
            flexShrink: 0,
            marginLeft: "0.75rem",
            boxShadow:
              project.status === "active"
                ? `0 0 8px color-mix(in srgb, ${ACCENT} 30%, transparent)`
                : "none",
          }}
        >
          {STATUS_LABEL[project.status] ?? project.status}
        </span>
      </div>

      {/* Separator */}
      <div
        style={{
          height: "1px",
          background: `linear-gradient(to right, ${ACCENT}30, transparent)`,
          marginBottom: "0.75rem",
        }}
      />

      {/* Description */}
      <p
        style={{
          fontSize: "0.85rem",
          lineHeight: 1.7,
          color: "#aaa",
          fontWeight: 300,
          marginBottom: "0.75rem",
        }}
      >
        {project.description}
      </p>

      {/* Updated date + Tags */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          alignItems: "center",
          marginBottom: "1rem",
        }}
      >
        {pushedAt && (
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.6rem",
              color: "#555",
              letterSpacing: "0.08em",
              marginRight: "0.25rem",
            }}
            title={`Last pushed: ${new Date(pushedAt).toLocaleDateString()}`}
          >
            updated {formatRelativeDate(pushedAt)}
          </span>
        )}
      </div>

      {/* Tags */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginBottom: "1rem",
        }}
      >
        {project.tags.map((tag) => (
          <span
            key={tag}
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.6rem",
              color: ACCENT,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "0.15rem 0.5rem",
              border: `1px solid color-mix(in srgb, ${ACCENT} 30%, transparent)`,
              borderRadius: "2px",
              background: `color-mix(in srgb, ${ACCENT} 5%, transparent)`,
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Links */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          borderTop: `1px solid color-mix(in srgb, ${ACCENT} 10%, #1a1a1a)`,
          paddingTop: "0.75rem",
        }}
      >
        {project.github_url && (
          <a
            href={project.github_url}
            target="_blank"
            rel="noopener noreferrer"
            className="code-link"
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.7rem",
              color: ACCENT,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
        )}
        {project.live_url && (
          <a
            href={project.live_url}
            target="_blank"
            rel="noopener noreferrer"
            className="code-link"
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.7rem",
              color: `color-mix(in srgb, ${ACCENT} 70%, #888)`,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            <span style={{ fontSize: "0.85rem" }}>&#8599;</span>
            Live
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Contribution graph ──────────────────────────── */

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ContributionGraph({ calendar }: { calendar: ContributionCalendar }) {
  const cellSize = 11;
  const cellGap = 2;
  const step = cellSize + cellGap;
  const weeks = calendar.weeks;
  const graphWidth = weeks.length * step;
  const graphHeight = 7 * step;

  // Build month label positions
  const monthPositions: { label: string; x: number }[] = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const firstDay = week.contributionDays[0];
    if (!firstDay) return;
    const month = new Date(firstDay.date).getMonth();
    if (month !== lastMonth) {
      monthPositions.push({ label: MONTH_LABELS[month], x: wi * step });
      lastMonth = month;
    }
  });

  return (
    <div style={{ overflowX: "auto", paddingBottom: "0.5rem" }}>
      <svg
        width={graphWidth + 30}
        height={graphHeight + 22}
        style={{ display: "block", margin: "0 auto" }}
      >
        {/* Month labels */}
        {monthPositions.map((m, i) => (
          <text
            key={i}
            x={m.x + 30}
            y={10}
            fill="#555"
            fontSize="9"
            fontFamily="var(--font-headline)"
          >
            {m.label}
          </text>
        ))}

        {/* Day labels */}
        {["Mon", "Wed", "Fri"].map((d, i) => (
          <text
            key={d}
            x={0}
            y={18 + (i * 2 + 1) * step + cellSize / 2}
            fill="#333"
            fontSize="8"
            fontFamily="var(--font-headline)"
            dominantBaseline="middle"
          >
            {d}
          </text>
        ))}

        {/* Cells */}
        {weeks.map((week, wi) =>
          week.contributionDays.map((day, di) => (
            <rect
              key={day.date}
              x={wi * step + 30}
              y={di * step + 18}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={getContribColor(day.contributionCount)}
              style={{ transition: "fill 0.15s" }}
            >
              <title>
                {day.date}: {day.contributionCount} contribution
                {day.contributionCount !== 1 ? "s" : ""}
              </title>
            </rect>
          )),
        )}
      </svg>
    </div>
  );
}

/* ── Refresh button ──────────────────────────────── */

function RefreshButton() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (store("adminToken")) setIsAdmin(true);
  }, []);

  if (!isAdmin) return null;

  function handleRefresh() {
    const token = store("adminToken") ?? "";
    window.location.href = `${API}/api/github/auth/?token=${encodeURIComponent(token)}`;
  }

  return (
    <button
      onClick={handleRefresh}
      title="Refresh contributions via GitHub"
      className="code-link"
      style={{
        background: "none",
        border: `1px solid color-mix(in srgb, ${ACCENT} 30%, transparent)`,
        borderRadius: "3px",
        cursor: "pointer",
        color: ACCENT,
        fontFamily: "var(--font-headline)",
        fontSize: "0.6rem",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        padding: "0.2rem 0.5rem",
        display: "flex",
        alignItems: "center",
        gap: "0.3rem",
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 2v6h-6" />
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M3 22v-6h6" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      </svg>
      Sync
    </button>
  );
}

/* ── Main component ──────────────────────────────── */

export default function CodesClient({
  calendar,
  repositoryDates,
}: {
  calendar: ContributionCalendar | null;
  repositoryDates: Record<string, string> | null;
}) {
  return (
    <>
      <div
        style={{
          maxWidth: "56rem",
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
          position: "relative",
          minHeight: "100vh",
          overflow: "hidden",
        }}
      >
        <CyberGrid accent={ACCENT} prefix="codes" />
        <HexDecorations accent={ACCENT} />

        {/* Tagline */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "3rem",
            position: "relative",
            zIndex: 2,
          }}
        >
          <p
            style={{
              fontStyle: "italic",
              color: "#666",
              fontSize: "0.9rem",
              letterSpacing: "0.04em",
            }}
          >
            i make spaghetti
          </p>
        </div>

        {/* Project cards */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1.5rem",
            position: "relative",
            zIndex: 2,
          }}
        >
          {PROJECTS.map((project) => (
            <ProjectCard
              key={project.slug}
              project={project}
              pushedAt={repositoryDates?.[project.github_url] ?? undefined}
            />
          ))}
        </div>

        {/* GitHub contribution graph */}
        <div
          style={{
            marginTop: "4rem",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "0.5rem",
            }}
          >
            {calendar && (
              <span
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.65rem",
                  color: "#555",
                  letterSpacing: "0.1em",
                }}
              >
                {calendar.totalContributions} contributions in the last year
              </span>
            )}
            <RefreshButton />
          </div>

          <div
            style={{
              background: "#0d1117",
              border: `1px solid color-mix(in srgb, ${ACCENT} 15%, #1a1a1a)`,
              borderRadius: "0.5rem",
              padding: "1rem",
            }}
          >
            {calendar ? (
              <ContributionGraph calendar={calendar} />
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: "2rem",
                  color: "#333",
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.7rem",
                  letterSpacing: "0.1em",
                }}
              >
                no contribution data yet
              </div>
            )}

            {/* Legend */}
            {calendar && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  gap: "0.3rem",
                  marginTop: "0.5rem",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontSize: "0.6rem",
                    color: "#444",
                    letterSpacing: "0.05em",
                    marginRight: "0.25rem",
                  }}
                >
                  Less
                </span>
                {[0, 2, 5, 10, 15].map((count) => (
                  <div
                    key={count}
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "2px",
                      background: getContribColor(count),
                    }}
                  />
                ))}
                <span
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontSize: "0.6rem",
                    color: "#444",
                    letterSpacing: "0.05em",
                    marginLeft: "0.25rem",
                  }}
                >
                  More
                </span>
              </div>
            )}
          </div>

        </div>

        {/* Bottom tagline */}
        <div
          style={{
            textAlign: "center",
            marginTop: "3rem",
            position: "relative",
            zIndex: 2,
          }}
        >
          <a
            href="https://github.com/nam685"
            target="_blank"
            rel="noopener noreferrer"
            className="code-link"
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.65rem",
              color: "#333",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
            }}
          >
            github.com/nam685
          </a>
        </div>
      </div>
    </>
  );
}
