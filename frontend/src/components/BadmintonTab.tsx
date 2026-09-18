"use client";

import { useCallback, useEffect, useState } from "react";
import { API } from "@/lib/api";
import { store, useIsAdmin } from "@/lib/auth";
import {
  formatSubmissionDate,
  parseTrackedUploads,
  statusLabel,
  type Player,
  type SubmissionDetail,
  type SubmissionStatus,
  type TrackedUpload,
} from "@/lib/badminton";
import AdminQueue, { ProgressBar } from "./badminton/AdminQueue";
import ReportTree, { type Selection } from "./badminton/ReportTree";
import SubmissionReport, { AttemptReport } from "./badminton/SubmissionReport";
import UploadPanel from "./badminton/UploadPanel";
import { ACCENT, btn, btnPrimary, label } from "./badminton/styles";

type TrackedStatus = {
  status: SubmissionStatus;
  step: string | null;
  stage: string | null;
  queue_position: number | null;
};

function positiveInt(raw: string | null): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function readUrl(): Selection {
  const q = new URLSearchParams(window.location.search);
  return {
    player: q.get("player"),
    sub: positiveInt(q.get("s")),
    attempt: positiveInt(q.get("a")),
  };
}

function writeUrl({ player, sub, attempt }: Selection) {
  const q = new URLSearchParams();
  if (player) q.set("player", player);
  if (sub) q.set("s", String(sub));
  if (sub && attempt) q.set("a", String(attempt));
  const qs = q.toString();
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${qs ? `?${qs}` : ""}`,
  );
}

export default function BadmintonTab() {
  const isAdmin = useIsAdmin();
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [sel, setSel] = useState<Selection>({
    player: null,
    sub: null,
    attempt: null,
  });
  const [urlRead, setUrlRead] = useState(false);
  const [details, setDetails] = useState<Record<number, SubmissionDetail>>({});
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(
    new Set(),
  );
  const [expandedSubs, setExpandedSubs] = useState<Set<number>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [tracked, setTracked] = useState<TrackedUpload[]>([]);
  const [trackedStatus, setTrackedStatus] = useState<
    Record<number, TrackedStatus | null>
  >({});

  const loadPlayers = useCallback(async () => {
    const res = await fetch(`${API}/api/badminton/players/`).catch(() => null);
    if (!res?.ok) {
      setPlayers([]);
      return;
    }
    const data = await res.json();
    setPlayers(data.players);
  }, []);

  // Initial load: players + URL selection + this browser's tracked uploads.
  useEffect(() => {
    loadPlayers();
    setSel(readUrl());
    setUrlRead(true);
    setTracked(parseTrackedUploads(store("badmintonUploads")));
  }, [loadPlayers]);

  // Once players arrive: keep a valid URL selection, else open the newest submission of the first
  // player. Either way, expand the path down to the selection.
  useEffect(() => {
    if (!urlRead || !players?.length) return;
    const owner = sel.sub
      ? players.find((p) => p.submissions.some((s) => s.id === sel.sub))
      : undefined;
    const next: Selection = owner
      ? { ...sel, player: owner.slug }
      : {
          player: players[0].slug,
          sub: players[0].submissions[0].id,
          attempt: null,
        };
    if (next.player !== sel.player || next.sub !== sel.sub) setSel(next);
    setExpandedPlayers((prev) =>
      prev.has(next.player!) ? prev : new Set(prev).add(next.player!),
    );
    setExpandedSubs((prev) =>
      prev.has(next.sub!) ? prev : new Set(prev).add(next.sub!),
    );
  }, [players, urlRead, sel]);

  useEffect(() => {
    if (urlRead) writeUrl(sel);
  }, [sel, urlRead]);

  // Fetch (once) every expanded submission: the tree needs its attempts, the pane its report.
  useEffect(() => {
    const token = store("adminToken");
    for (const id of expandedSubs) {
      if (details[id]) continue;
      fetch(`${API}/api/badminton/submissions/${id}/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: SubmissionDetail | null) => {
          if (d) setDetails((prev) => ({ ...prev, [id]: d }));
        })
        .catch(() => {});
    }
  }, [expandedSubs, details]);

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  }

  // Bring the document pane into view (it sits below the tree on mobile).
  function showDoc() {
    document
      .querySelector(".bm-doc")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSub(player: string, sub: number) {
    setSel({ player, sub, attempt: null });
    showDoc();
    setExpandedSubs((prev) => (prev.has(sub) ? prev : new Set(prev).add(sub)));
  }

  function openAttempt(player: string, sub: number, attempt: number) {
    setSel({ player, sub, attempt });
    showDoc();
  }

  // Poll the status of uploads made from this browser until they finish.
  const refreshTracked = useCallback(async () => {
    const list = parseTrackedUploads(store("badmintonUploads"));
    setTracked(list);
    const entries = await Promise.all(
      list.map(async (u) => {
        const r = await fetch(
          `${API}/api/badminton/submissions/${u.id}/status/`,
        ).catch(() => null);
        if (r?.status === 404) return [u.id, null] as const;
        if (!r?.ok) return [u.id, undefined] as const;
        return [u.id, (await r.json()) as TrackedStatus] as const;
      }),
    );
    const next: Record<number, TrackedStatus | null> = {};
    for (const [id, st] of entries) if (st !== undefined) next[id] = st;
    setTrackedStatus((prev) => {
      // A tracked upload just finished → its report is public now; refresh the player list.
      if (
        entries.some(
          ([id, st]) => st?.status === "done" && prev[id]?.status !== "done",
        )
      )
        loadPlayers();
      return next;
    });
  }, [loadPlayers]);

  useEffect(() => {
    if (!tracked.length) return;
    refreshTracked();
    const t = setInterval(refreshTracked, 15_000);
    return () => clearInterval(t);
  }, [tracked.length, refreshTracked]);

  function forget(id: number) {
    const list = parseTrackedUploads(store("badmintonUploads")).filter(
      (u) => u.id !== id,
    );
    store("badmintonUploads", JSON.stringify(list));
    setTracked(list);
  }

  async function deleteReport(id: number) {
    await fetch(`${API}/api/badminton/submissions/${id}/delete/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${store("adminToken")}` },
    });
    setSel({ player: null, sub: null, attempt: null });
    loadPlayers();
  }

  const detail = sel.sub ? details[sel.sub] : undefined;
  const attempt =
    detail && sel.attempt != null
      ? detail.report.attempts?.find((a) => a.number === sel.attempt)
      : undefined;
  const activeTracked = tracked.filter((u) => trackedStatus[u.id] !== null);

  return (
    <div className="bm-root">
      {isAdmin && <AdminQueue onChanged={loadPlayers} />}

      <div className="bm-toolbar">
        {!showUpload && (
          <button style={btnPrimary} onClick={() => setShowUpload(true)}>
            + analyse my clear
          </button>
        )}
      </div>

      {showUpload && (
        <UploadPanel
          players={players || []}
          onUploaded={() =>
            setTracked(parseTrackedUploads(store("badmintonUploads")))
          }
          onClose={() => setShowUpload(false)}
        />
      )}

      {/* Uploads made from this browser */}
      {activeTracked.length > 0 && (
        <div
          style={{ marginBottom: "1.25rem", display: "grid", gap: "0.4rem" }}
        >
          <div style={label}>your uploads</div>
          {activeTracked.map((u) => {
            const st = trackedStatus[u.id];
            return (
              <div key={u.id} className="bm-tracked">
                <span style={{ color: "#ddd" }}>{u.name}</span>
                <span style={{ color: "#777" }}>
                  {formatSubmissionDate(u.recorded_on)}
                </span>
                <span
                  style={{
                    color: st?.status === "failed" ? "#ef4444" : ACCENT,
                  }}
                >
                  {st ? statusLabel(st.status, st.queue_position) : "…"}
                </span>
                {st?.status === "done" && (
                  <button
                    style={{ ...btn, padding: "0.15rem 0.5rem" }}
                    onClick={() => {
                      const owner = players?.find((p) =>
                        p.submissions.some((s) => s.id === u.id),
                      );
                      if (owner) {
                        setExpandedPlayers((prev) =>
                          new Set(prev).add(owner.slug),
                        );
                        openSub(owner.slug, u.id);
                      }
                    }}
                  >
                    open report
                  </button>
                )}
                {(st?.status === "done" || st?.status === "failed") && (
                  <button
                    style={{ ...btn, padding: "0.15rem 0.5rem" }}
                    onClick={() => forget(u.id)}
                  >
                    dismiss
                  </button>
                )}
                {st?.status === "running" && (
                  <div style={{ flexBasis: "100%" }}>
                    <ProgressBar step={st.step} stage={st.stage} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {players === null ? null : players.length === 0 ? (
        <p style={{ color: "#555", fontStyle: "italic", fontSize: "0.85rem" }}>
          No reports yet — upload a video of your overhead clear and get a
          coach&apos;s breakdown of every attempt.
        </p>
      ) : (
        <div className="bm-shell">
          <aside className="bm-side">
            <ReportTree
              players={players}
              details={details}
              expandedPlayers={expandedPlayers}
              expandedSubs={expandedSubs}
              selection={sel}
              onTogglePlayer={(slug) =>
                setExpandedPlayers((prev) => toggle(prev, slug))
              }
              onToggleSub={(id) => setExpandedSubs((prev) => toggle(prev, id))}
              onOpenSub={openSub}
              onOpenAttempt={openAttempt}
            />
          </aside>
          <main className="bm-doc">
            {!detail ? (
              <div style={{ color: "#555", fontSize: "0.8rem" }}>loading…</div>
            ) : sel.attempt != null && attempt ? (
              <AttemptReport
                key={`${detail.id}-${attempt.number}`}
                detail={detail}
                attempt={attempt}
                onOpenAttempt={(n) =>
                  openAttempt(detail.player.slug, detail.id, n)
                }
              />
            ) : (
              <SubmissionReport
                detail={detail}
                isAdmin={isAdmin}
                onDelete={() => deleteReport(detail.id)}
                onOpenAttempt={(n) =>
                  openAttempt(detail.player.slug, detail.id, n)
                }
              />
            )}
          </main>
        </div>
      )}

      <style>{`
        .bm-root { max-width: 72rem; margin-inline: auto; }
        .bm-toolbar { display: flex; justify-content: flex-end; margin-bottom: 1rem; }
        .bm-shell { display: flex; gap: 1.5rem; align-items: flex-start; }
        .bm-side { width: 16rem; flex-shrink: 0; position: sticky; top: 4.5rem; max-height: calc(100vh - 5.5rem);
          overflow-y: auto; overflow-x: hidden; border-right: 1px solid #161616; padding-right: 0.5rem; }
        .bm-doc { flex: 1; min-width: 0; scroll-margin-top: 4.5rem; }
        .bm-tree { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1px; }
        .bm-tree-row { display: flex; align-items: center; gap: 0.35rem; width: 100%; min-height: 1.9rem;
          text-align: left; background: transparent; border: none; border-radius: 3px; cursor: pointer;
          font-size: 0.78rem; padding-right: 0.4rem; border-left: 2px solid transparent; }
        .bm-tree-row:hover { background: #0e1215; }
        .bm-tree-row.sel { background: #0f1419; border-left-color: var(--accent); }
        .bm-tree-chev, .bm-tree-label { background: none; border: none; cursor: pointer; padding: 0; font-size: 0.78rem;
          text-align: left; }
        .bm-tree-label { flex: 1; min-width: 0; }
        .bm-tree-count { margin-left: auto; font-size: 0.6rem; color: #555; }
        .bm-tree-hint { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #555;
          font-size: 0.66rem; }
        .bm-upload { display: flex; flex-wrap: wrap; gap: 1.5rem; }
        .bm-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }
        .bm-tips { flex: 1 1 16rem; min-width: 0; font-size: 0.76rem; color: #999; line-height: 1.55; }
        .bm-tips ul { padding-left: 1rem; margin: 0; display: grid; gap: 0.35rem; }
        .bm-tips p { margin: 0; }
        .bm-tips b { color: #ccc; font-weight: 600; }
        .bm-tracked { display: flex; flex-wrap: wrap; gap: 0.4rem 0.9rem; align-items: center; font-size: 0.75rem;
          border: 1px solid #1a1a1a; border-radius: 3px; padding: 0.45rem 0.7rem; }
        .bm-table { width: 100%; border-collapse: collapse; font-size: 0.74rem; }
        .bm-table th { text-align: left; font-weight: 400; color: #555; padding: 0.2rem 0.4rem; font-size: 0.62rem;
          text-transform: uppercase; letter-spacing: 0.08em; }
        .bm-table td { padding: 0.25rem 0.4rem; color: #999; border-top: 1px solid #151515; vertical-align: top; }
        .bm-table td:first-child { width: 60%; }
        @media (max-width: 768px) {
          .bm-shell { flex-direction: column; }
          .bm-side { width: 100%; position: static; max-height: 45vh; border-right: none;
            border-bottom: 1px solid #161616; padding: 0 0 0.5rem; }
          .bm-form-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
