"use client";

import { API } from "@/lib/api";
import {
  formatMeasure,
  mediaUrl,
  formatSubmissionDate,
  visibleRows,
  type Attempt,
  type Finding,
  type Measurement,
  type SubmissionDetail,
} from "@/lib/badminton";
import { ACCENT, btn, card, label, summaryStyle, video } from "./styles";

const text: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "#ccc",
  lineHeight: 1.6,
  margin: 0,
};

/** Right-pane document for a submission: the coach's verdict. Attempts open from the left nav. */
export default function SubmissionReport({
  detail,
  isAdmin,
  onDelete,
  onOpenAttempt,
}: {
  detail: SubmissionDetail;
  isAdmin: boolean;
  onDelete: () => void;
  onOpenAttempt: (n: number) => void;
}) {
  const r = detail.report;
  const verdict = r.verdict;
  const attempts = r.attempts || [];

  return (
    <div style={{ display: "grid", gap: "1.25rem", minWidth: 0 }}>
      <header>
        <div style={{ ...label, color: ACCENT }}>{detail.player.name}</div>
        <h2
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "1.2rem",
            color: "#eee",
            margin: "0.2rem 0 0.4rem",
          }}
        >
          {formatSubmissionDate(detail.recorded_on, r.recorded_at)}
        </h2>
        <div
          style={{
            fontSize: "0.72rem",
            color: "#777",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <span>
            {attempts.length} attempt{attempts.length === 1 ? "" : "s"}
          </span>
          {r.reference && <span>compared with: {r.reference}</span>}
          {verdict?.confidence && (
            <span>coach confidence: {verdict.confidence}</span>
          )}
          {isAdmin && (
            <button
              style={{
                ...btn,
                padding: "0.1rem 0.5rem",
                color: "#ef4444",
                borderColor: "#442222",
              }}
              onClick={() => {
                if (confirm("Delete this report and all its clips?"))
                  onDelete();
              }}
            >
              delete
            </button>
          )}
        </div>
      </header>

      {verdict && (
        <section style={{ display: "grid", gap: "0.9rem" }}>
          {verdict.progress && (
            <div style={{ ...card, borderLeft: `2px solid ${ACCENT}` }}>
              <div style={{ ...label, marginBottom: "0.35rem" }}>
                since last time
              </div>
              <p style={text}>{verdict.progress}</p>
            </div>
          )}
          {!!verdict.strengths?.length && (
            <div style={card}>
              <div
                style={{ ...label, marginBottom: "0.35rem", color: "#22c55e" }}
              >
                what&apos;s working
              </div>
              <ul style={{ ...text, paddingLeft: "1.1rem" }}>
                {verdict.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {(verdict.findings || []).map((f, i) => (
            <FindingCard
              key={i}
              finding={f}
              index={i}
              onOpenAttempt={onOpenAttempt}
            />
          ))}
          {verdict.measurement_notes && (
            <details>
              <summary style={summaryStyle}>
                what could and couldn&apos;t be measured
              </summary>
              <p style={{ ...text, fontSize: "0.78rem", color: "#999" }}>
                {verdict.measurement_notes}
              </p>
            </details>
          )}
        </section>
      )}

      {!!r.videos?.length && (
        <details>
          <summary style={summaryStyle}>where the attempts were found</summary>
          <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.5rem" }}>
            {r.videos.map((v, i) => (
              <div key={i}>
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "#888",
                    marginBottom: "0.3rem",
                  }}
                >
                  {v.name}
                  {v.duration_s != null && ` · ${Math.round(v.duration_s)} s`}
                  {v.capture_fps && ` · ${v.capture_fps} fps`}
                  {v.attempts_found != null &&
                    ` · ${v.attempts_kept ?? "?"} of ${v.attempts_found} attempts kept`}
                </div>
                {v.timeline && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(API, v.timeline)}
                    alt="timeline"
                    loading="lazy"
                    style={{ width: "100%", borderRadius: "3px" }}
                  />
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function FindingCard({
  finding: f,
  index,
  onOpenAttempt,
}: {
  finding: Finding;
  index: number;
  onOpenAttempt: (n: number) => void;
}) {
  const ev = f.evidence;
  return (
    <div style={card}>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline" }}>
        <span
          style={{
            fontFamily: "var(--font-headline)",
            color: ACCENT,
            fontSize: "0.9rem",
          }}
        >
          {index + 1}
        </span>
        <h3 style={{ fontSize: "0.95rem", color: "#eee", margin: 0, flex: 1 }}>
          {f.title}
        </h3>
        {f.pattern && (
          <span className="tag" style={{ fontSize: "0.55rem" }}>
            {f.pattern}
          </span>
        )}
      </div>
      {f.explanation && (
        <p style={{ ...text, marginTop: "0.5rem" }}>{f.explanation}</p>
      )}
      {f.cue && (
        <p style={{ ...text, marginTop: "0.5rem" }}>
          <span style={{ ...label, color: ACCENT, marginRight: "0.4rem" }}>
            cue
          </span>
          {f.cue}
        </p>
      )}
      {f.drill && (
        <p style={{ ...text, marginTop: "0.4rem" }}>
          <span style={{ ...label, color: ACCENT, marginRight: "0.4rem" }}>
            drill
          </span>
          {f.drill}
        </p>
      )}
      {ev && (ev.visual || ev.attempts?.length || ev.measurements?.length) ? (
        <details style={{ marginTop: "0.5rem" }}>
          <summary style={summaryStyle}>evidence</summary>
          {ev.visual && (
            <p style={{ ...text, fontSize: "0.78rem", color: "#aaa" }}>
              {ev.visual}
            </p>
          )}
          {!!ev.attempts?.length && (
            <div
              style={{ fontSize: "0.75rem", color: "#888", margin: "0.4rem 0" }}
            >
              seen in attempt{ev.attempts.length === 1 ? "" : "s"}{" "}
              {ev.attempts.map((n, i) => (
                <span key={n}>
                  {i > 0 && ", "}
                  <a
                    href={`#attempt-${n}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenAttempt(n);
                    }}
                    style={{ color: ACCENT }}
                  >
                    {n}
                  </a>
                </span>
              ))}
            </div>
          )}
          <MeasureTable rows={ev.measurements} />
        </details>
      ) : null}
    </div>
  );
}

/** Right-pane document for one attempt: annotated clip first, everything else collapsed. */
export function AttemptReport({
  detail,
  attempt: a,
  onOpenAttempt,
}: {
  detail: SubmissionDetail;
  attempt: Attempt;
  onOpenAttempt: (n: number) => void;
}) {
  const numbers = (detail.report.attempts || []).map((x) => x.number);
  const i = numbers.indexOf(a.number);
  const prev = i > 0 ? numbers[i - 1] : null;
  const next = i >= 0 && i < numbers.length - 1 ? numbers[i + 1] : null;
  return (
    <div style={{ display: "grid", gap: "1rem", minWidth: 0 }}>
      <header>
        <div style={{ ...label, color: ACCENT }}>
          {detail.player.name} ·{" "}
          {formatSubmissionDate(detail.recorded_on, detail.report.recorded_at)}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            margin: "0.2rem 0 0",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "1.2rem",
              color: "#eee",
              margin: 0,
              flex: 1,
            }}
          >
            Attempt {a.number}
            <span style={{ color: "#555", fontSize: "0.8rem" }}>
              {" "}
              / {numbers.length}
            </span>
          </h2>
          <button
            style={{ ...btn, opacity: prev == null ? 0.3 : 1 }}
            disabled={prev == null}
            onClick={() => prev != null && onOpenAttempt(prev)}
          >
            ‹ prev
          </button>
          <button
            style={{ ...btn, opacity: next == null ? 0.3 : 1 }}
            disabled={next == null}
            onClick={() => next != null && onOpenAttempt(next)}
          >
            next ›
          </button>
        </div>
      </header>
      <AttemptCard key={a.number} attempt={a} />
    </div>
  );
}

function AttemptCard({ attempt: a }: { attempt: Attempt }) {
  const slow = a.playback_speed != null && a.playback_speed < 1;
  const groups = (a.measurements || []).filter(
    (g) => visibleRows(g.rows).length > 0,
  );
  return (
    <div
      id={`attempt-${a.number}`}
      style={{ ...card, scrollMarginTop: "5rem" }}
    >
      <div
        style={{
          display: "flex",
          gap: "0.6rem",
          alignItems: "baseline",
          marginBottom: "0.5rem",
        }}
      >
        <span style={{ fontSize: "0.82rem", color: "#ccc", flex: 1 }}>
          {a.verdict}
        </span>
      </div>
      {a.annotated_clip && (
        <>
          <video
            src={mediaUrl(API, a.annotated_clip)}
            muted
            playsInline
            controls
            preload="metadata"
            style={video}
          />
          {slow && (
            <div
              style={{
                fontSize: "0.65rem",
                color: "#666",
                marginTop: "0.25rem",
              }}
            >
              plays at {a.playback_speed === 0.5 ? "½" : `${a.playback_speed}×`}{" "}
              speed
            </div>
          )}
        </>
      )}
      <div style={{ display: "grid", gap: "0.2rem", marginTop: "0.5rem" }}>
        {a.extracted_clip && (
          <details>
            <summary style={summaryStyle}>raw clip</summary>
            <video
              src={mediaUrl(API, a.extracted_clip)}
              muted
              playsInline
              controls
              preload="none"
              style={video}
            />
          </details>
        )}
        {a.key_moments && (
          <details>
            <summary style={summaryStyle}>key moments</summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(API, a.key_moments)}
              alt="key moments"
              loading="lazy"
              style={{ width: "100%" }}
            />
          </details>
        )}
        {a.signals && (
          <details>
            <summary style={summaryStyle}>motion signals</summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl(API, a.signals)}
              alt="speed, elbow and rotation over time"
              loading="lazy"
              style={{ width: "100%" }}
            />
          </details>
        )}
        {(groups.length > 0 || !!a.footwork_labels?.length) && (
          <details>
            <summary style={summaryStyle}>measurements</summary>
            {groups.map((g) => (
              <div key={g.group} style={{ marginTop: "0.5rem" }}>
                <div style={{ ...label, marginBottom: "0.25rem" }}>
                  {g.group}
                </div>
                <MeasureTable rows={g.rows} />
              </div>
            ))}
            {!!a.footwork_labels?.length && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={{ ...label, marginBottom: "0.25rem" }}>
                  footwork
                </div>
                <table className="bm-table">
                  <tbody>
                    {a.footwork_labels.map((l) => (
                      <tr key={l.id}>
                        <td>{l.label}</td>
                        <td>{l.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        )}
        {!!a.notes?.length && (
          <details>
            <summary style={summaryStyle}>notes</summary>
            <ul
              style={{
                ...text,
                fontSize: "0.78rem",
                color: "#999",
                paddingLeft: "1.1rem",
              }}
            >
              {a.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function MeasureTable({ rows }: { rows: Measurement[] | undefined }) {
  const shown = visibleRows(rows);
  if (!shown.length) return null;
  const hasRef = shown.some((r) => r.reference != null);
  return (
    <table className="bm-table">
      <thead>
        <tr>
          <th />
          <th>you</th>
          {hasRef && <th>reference</th>}
        </tr>
      </thead>
      <tbody>
        {shown.map((m, i) => (
          <tr key={m.id ?? i}>
            <td>{m.label}</td>
            <td style={{ color: "#eee" }}>{formatMeasure(m.value, m.unit)}</td>
            {hasRef && <td>{formatMeasure(m.reference, m.unit)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
