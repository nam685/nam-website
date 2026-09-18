"use client";

import { useState } from "react";
import { API } from "@/lib/api";
import { store } from "@/lib/auth";
import {
  formatBytes,
  localIsoDate,
  parseTrackedUploads,
  type Player,
} from "@/lib/badminton";
import { btn, btnPrimary, card, input, label } from "./styles";

const MAX_BYTES = 2 * 1024 ** 3;
const NEW = "__new__";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; sent: number; total: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** A 4xx from the server: retrying the same chunk can't help. */
class FatalUploadError extends Error {}

/** POST one chunk with XHR so we get upload progress events. */
function sendChunk(
  url: string,
  token: string,
  offset: number,
  blob: Blob,
  onProgress: (loaded: number) => void,
): Promise<{ status: number; body: { received?: number; error?: string } }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network error"));
    const fd = new FormData();
    fd.append("upload_token", token);
    fd.append("offset", String(offset));
    fd.append("chunk", blob, "chunk");
    xhr.send(fd);
  });
}

export default function UploadPanel({
  players,
  onUploaded,
  onClose,
}: {
  players: Player[];
  onUploaded: () => void;
  onClose: () => void;
}) {
  const [who, setWho] = useState<string>(players[0]?.slug ?? NEW);
  const [name, setName] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [hand, setHand] = useState("");
  const [lang, setLang] = useState("en");
  const [date, setDate] = useState(localIsoDate(Date.now()));
  const [dateTouched, setDateTouched] = useState(false);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const busy = phase.kind === "uploading";

  function pickFile(f: File | null) {
    setFile(f);
    if (f && !dateTouched && f.lastModified)
      setDate(localIsoDate(f.lastModified));
  }

  async function upload() {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setPhase({ kind: "error", message: "Video too large (max 2 GB)." });
      return;
    }
    const displayName =
      who === NEW ? name.trim() : players.find((p) => p.slug === who)?.name;
    setPhase({ kind: "uploading", sent: 0, total: file.size });
    try {
      const adminToken = store("adminToken");
      const res = await fetch(`${API}/api/badminton/submit/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          ...(who === NEW ? { name: name.trim() } : { player: who }),
          height_m: heightCm ? Number(heightCm) / 100 : null,
          hand,
          lang,
          recorded_on: date,
          note,
          filename: file.name,
          size: file.size,
        }),
      });
      const start = await res.json();
      if (!res.ok)
        throw new Error(start.error || `upload refused (${res.status})`);
      const { id, upload_token: token, chunk_size: chunkSize } = start;

      let offset = 0;
      let failures = 0;
      while (offset < file.size) {
        const blob = file.slice(offset, offset + chunkSize);
        const base = offset;
        try {
          const r = await sendChunk(
            `${API}/api/badminton/submit/${id}/chunk/`,
            token,
            offset,
            blob,
            (loaded) =>
              setPhase({
                kind: "uploading",
                sent: base + loaded,
                total: file.size,
              }),
          );
          if (r.status === 200 || r.status === 409) {
            if (typeof r.body.received !== "number")
              throw new Error(r.body.error);
            offset = r.body.received;
            failures = 0;
            continue;
          }
          if (r.status < 500)
            throw new FatalUploadError(
              r.body.error || `upload failed (${r.status})`,
            );
          throw new Error(`server error (${r.status})`);
        } catch (e) {
          // Retry transient failures (network blip, 5xx) a few times, resuming at the server's offset.
          if (e instanceof FatalUploadError || ++failures > 4) throw e;
          await new Promise((ok) => setTimeout(ok, 2000 * failures));
        }
      }

      const doneForm = new FormData();
      doneForm.append("upload_token", token);
      const done = await fetch(`${API}/api/badminton/submit/${id}/complete/`, {
        method: "POST",
        body: doneForm,
      });
      const doneBody = await done.json().catch(() => ({}));
      if (!done.ok)
        throw new Error(doneBody.error || `upload failed (${done.status})`);

      const tracked = parseTrackedUploads(store("badmintonUploads"));
      tracked.unshift({ id, name: displayName || "?", recorded_on: date });
      store("badmintonUploads", JSON.stringify(tracked.slice(0, 20)));
      setPhase({ kind: "done" });
      onUploaded();
    } catch (e) {
      setPhase({
        kind: "error",
        message: e instanceof Error && e.message ? e.message : "Upload failed.",
      });
    }
  }

  const canSubmit =
    !!file && !busy && (who !== NEW || name.trim().length > 0) && !!date;

  return (
    <div className="bm-upload" style={{ ...card, marginBottom: "1.25rem" }}>
      <div style={{ flex: "1 1 22rem", minWidth: 0 }}>
        <div
          style={{ ...label, marginBottom: "0.75rem", color: "var(--accent)" }}
        >
          analyse my clear
        </div>
        {phase.kind === "done" ? (
          <div style={{ fontSize: "0.85rem", color: "#ccc", lineHeight: 1.6 }}>
            Uploaded. Nam will take a look and start the analysis — it takes
            anywhere from 15 minutes to an hour once it runs. Your upload is
            tracked below; the report appears here when it&apos;s ready.
            <div
              style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem" }}
            >
              <button
                style={btn}
                onClick={() => {
                  setFile(null);
                  setPhase({ kind: "idle" });
                }}
              >
                upload another
              </button>
              <button style={btn} onClick={onClose}>
                close
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.7rem" }}>
            <Field title="who's swinging">
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <select
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  disabled={busy}
                  style={{ ...input, width: "auto", flex: "1 1 8rem" }}
                >
                  {players.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                  <option value={NEW}>someone new…</option>
                </select>
                {who === NEW && (
                  <input
                    style={{ ...input, flex: "2 1 10rem", width: "auto" }}
                    placeholder="your name"
                    maxLength={40}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy}
                  />
                )}
              </div>
            </Field>
            <div className="bm-form-row">
              <Field title="height (cm, optional)">
                <input
                  style={input}
                  type="number"
                  inputMode="numeric"
                  min={100}
                  max={250}
                  placeholder="171"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  disabled={busy}
                />
              </Field>
              <Field title="racket hand">
                <select
                  style={input}
                  value={hand}
                  onChange={(e) => setHand(e.target.value)}
                  disabled={busy}
                >
                  <option value="">not sure / skip</option>
                  <option value="right">right</option>
                  <option value="left">left</option>
                </select>
              </Field>
            </div>
            <div className="bm-form-row">
              <Field title="recorded on">
                <input
                  style={input}
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setDateTouched(true);
                  }}
                  disabled={busy}
                />
              </Field>
              <Field title="report language">
                <select
                  style={input}
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  disabled={busy}
                >
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                  <option value="vi">Tiếng Việt</option>
                </select>
              </Field>
            </div>
            <Field title="note for Nam (optional)">
              <input
                style={input}
                maxLength={500}
                placeholder="e.g. new racket, sore shoulder…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy}
              />
            </Field>
            <Field title="video (up to 2 GB)">
              <input
                type="file"
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                disabled={busy}
                style={{ fontSize: "0.75rem", color: "#aaa" }}
              />
              {file && (
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#666",
                    marginLeft: "0.5rem",
                  }}
                >
                  {formatBytes(file.size)}
                </span>
              )}
            </Field>

            {phase.kind === "uploading" && (
              <div>
                <div
                  style={{
                    height: "4px",
                    background: "#1a1a1a",
                    borderRadius: "2px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(100 * phase.sent) / phase.total}%`,
                      background: "var(--accent)",
                      transition: "width 0.2s",
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "#777",
                    marginTop: "0.3rem",
                  }}
                >
                  uploading {formatBytes(phase.sent)} /{" "}
                  {formatBytes(phase.total)} — keep this tab open
                </div>
              </div>
            )}
            {phase.kind === "error" && (
              <div style={{ fontSize: "0.78rem", color: "#ef4444" }}>
                {phase.message}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.4 }}
                disabled={!canSubmit}
                onClick={upload}
              >
                {busy ? "uploading…" : "upload"}
              </button>
              <button style={btn} onClick={onClose} disabled={busy}>
                cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bm-tips">
        <div style={{ ...label, marginBottom: "0.5rem" }}>how to film</div>
        <ul>
          <li>
            <b>Side-on</b>, whole body and racket in frame; phone fixed (leaning
            against something is fine), not hand-held.
          </li>
          <li>
            <b>5+ clears in one continuous clip</b>, a short pause between them.
            No need to trim.
          </li>
          <li>
            <b>Slow motion (120 fps)</b> and a fast shutter if your phone allows
            — the racket blurs away otherwise.
          </li>
          <li>
            Back camera if possible; plain background, nobody else moving.
          </li>
        </ul>
        <div style={{ ...label, margin: "0.9rem 0 0.4rem" }}>privacy</div>
        <p>
          Nothing runs until Nam approves it. The analysis runs on Nam&apos;s
          own PC; frames and measurements go to Claude for the coaching.
          Finished reports — including the annotated clips — are <b>public</b>{" "}
          on this page. The original upload is deleted afterwards. Want it gone?
          Use the feedback button.
        </p>
      </div>
    </div>
  );
}

function Field({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "block", minWidth: 0 }}>
      <div style={{ ...label, marginBottom: "0.3rem" }}>{title}</div>
      {children}
    </label>
  );
}
