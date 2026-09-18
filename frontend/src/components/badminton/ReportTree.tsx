"use client";

import {
  formatSubmissionDate,
  type Player,
  type SubmissionDetail,
} from "@/lib/badminton";
import { ACCENT } from "./styles";

export type Selection = {
  player: string | null;
  sub: number | null;
  attempt: number | null;
};

/**
 * Confluence-style left nav: players → dated submissions → attempts.
 * Clicking a player only expands/collapses it; clicking a submission or attempt opens it in the
 * right-hand document pane (and expands it). Chevrons toggle without opening.
 */
export default function ReportTree({
  players,
  details,
  expandedPlayers,
  expandedSubs,
  selection,
  onTogglePlayer,
  onToggleSub,
  onOpenSub,
  onOpenAttempt,
}: {
  players: Player[];
  details: Record<number, SubmissionDetail>;
  expandedPlayers: Set<string>;
  expandedSubs: Set<number>;
  selection: Selection;
  onTogglePlayer: (slug: string) => void;
  onToggleSub: (id: number) => void;
  onOpenSub: (slug: string, id: number) => void;
  onOpenAttempt: (slug: string, id: number, n: number) => void;
}) {
  return (
    <nav className="bm-tree" aria-label="badminton reports">
      {players.map((p) => {
        const pOpen = expandedPlayers.has(p.slug);
        return (
          <div key={p.slug}>
            <button
              className="bm-tree-row"
              style={{ paddingLeft: "0.4rem" }}
              onClick={() => onTogglePlayer(p.slug)}
              aria-expanded={pOpen}
            >
              <Chevron open={pOpen} />
              <span style={{ color: "#ddd", fontWeight: 600 }}>{p.name}</span>
              <span className="bm-tree-count">{p.submissions.length}</span>
            </button>
            {pOpen &&
              p.submissions.map((s) => {
                const sOpen = expandedSubs.has(s.id);
                const sSel =
                  selection.sub === s.id && selection.attempt == null;
                const attempts = details[s.id]?.report.attempts;
                return (
                  <div key={s.id}>
                    <div
                      className={`bm-tree-row${sSel ? " sel" : ""}`}
                      style={{ paddingLeft: "1.1rem" }}
                    >
                      <button
                        className="bm-tree-chev"
                        onClick={() => onToggleSub(s.id)}
                        aria-label={sOpen ? "collapse" : "expand"}
                        aria-expanded={sOpen}
                      >
                        <Chevron open={sOpen} />
                      </button>
                      <button
                        className="bm-tree-label"
                        onClick={() => onOpenSub(p.slug, s.id)}
                        style={{ color: sSel ? ACCENT : "#bbb" }}
                      >
                        {formatSubmissionDate(s.recorded_on)}
                      </button>
                      <span className="bm-tree-count">{s.attempts}</span>
                    </div>
                    {sOpen &&
                      (attempts ? (
                        attempts.map((a) => {
                          const aSel =
                            selection.sub === s.id &&
                            selection.attempt === a.number;
                          return (
                            <button
                              key={a.number}
                              className={`bm-tree-row${aSel ? " sel" : ""}`}
                              style={{
                                paddingLeft: "2.6rem",
                                color: aSel ? ACCENT : "#888",
                              }}
                              onClick={() =>
                                onOpenAttempt(p.slug, s.id, a.number)
                              }
                              title={a.verdict ?? undefined}
                            >
                              <span style={{ flexShrink: 0 }}>
                                Attempt {a.number}
                              </span>
                              {a.verdict && (
                                <span className="bm-tree-hint">
                                  {a.verdict}
                                </span>
                              )}
                            </button>
                          );
                        })
                      ) : (
                        <div
                          className="bm-tree-row"
                          style={{ paddingLeft: "2.6rem", color: "#555" }}
                        >
                          loading…
                        </div>
                      ))}
                  </div>
                );
              })}
          </div>
        );
      })}
    </nav>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: "0.8rem",
        color: "#666",
        fontSize: "0.6rem",
        transform: open ? "rotate(90deg)" : "none",
        transition: "transform 0.12s",
      }}
    >
      ▶
    </span>
  );
}
