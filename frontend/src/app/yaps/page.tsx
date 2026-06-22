"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type Thought, API } from "@/lib/api";
import { store, storeDel, getAdminToken } from "@/lib/auth";
import { formatDate } from "@/lib/date";
import { clearDraft, loadDraft, saveDraft, withImages } from "@/lib/thoughtDraft";

const COOLDOWN_MS = 18 * 60 * 60 * 1000; // 18h

const FALLBACK: Thought[] = [
  {
    id: 0,
    content: "This is my public diary. Certified 100% human generated.",
    image: null,
    video: null,
    created_at: "2026-03-28T00:00:00Z",
  },
];

/* Trunk geometry */
const TRUNK = "1.25rem";
const NODE_SIZE = 10;
const HALF_NODE = NODE_SIZE / 2;

/* ── Compose card ───────────────────────────────────── */
function ComposeCard({ onPost }: { onPost: (t: Thought) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Restore a saved draft on mount; auto-open if there is one.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setText(draft);
      setOpen(true);
    }
  }, []);

  // Persist text as a draft whenever it changes.
  useEffect(() => {
    saveDraft(text);
  }, [text]);

  // Revoke object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // The [preview] effect above is the single owner of revocation — it revokes the
  // previous URL when preview changes or on unmount, so attach/removeMedia don't.
  function attach(f: File | undefined | null) {
    if (!f || (!f.type.startsWith("image/") && !f.type.startsWith("video/"))) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  function removeMedia() {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  const isVideo = !!file && file.type.startsWith("video/");

  function isCoolingDown() {
    const last = store("lastThoughtTime");
    if (!last) return false;
    return Date.now() - Number(last) < COOLDOWN_MS;
  }

  function handleOpen() {
    if (isCoolingDown()) {
      setError("Chill. Too much thinking for today.");
      setTimeout(() => setError(""), 3000);
      return;
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 120);
  }

  function onPaste(e: React.ClipboardEvent) {
    const img = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      attach(img);
    }
  }

  async function handleSubmit() {
    const content = text.trim();
    if ((!content && !file) || posting) return;

    const token = getAdminToken();
    if (!token) return; // redirected to /sudo — draft text already persisted

    setPosting(true);
    setError("");
    try {
      const form = new FormData();
      if (content) form.append("content", content);
      if (file) form.append(file.type.startsWith("video/") ? "video" : "image", file);
      const res = await fetch(`${API}/api/thoughts/create/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (res.status === 401) {
        storeDel("adminToken");
        setError("Bad token — cleared, try again");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Failed");
        return;
      }
      const thought: Thought = await res.json();
      store("lastThoughtTime", String(Date.now()));
      onPost(thought);
      setText("");
      clearDraft();
      removeMedia();
      setOpen(false);
    } catch {
      setError("Network error");
    } finally {
      setPosting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") setOpen(false); // text/image stay cached
  }

  const canPost = (text.trim() || file) && !posting;

  if (!open) {
    return (
      <div ref={wrapperRef} style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.5rem" }}>
        {error && (
          <span style={{ fontSize: "0.7rem", color: "var(--accent)", fontFamily: "var(--font-headline)", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
            {error}
          </span>
        )}
        <button
          onClick={handleOpen}
          aria-label="New post"
          title={isCoolingDown() ? "Chill. Too much thinking for today." : text || file ? "Continue editing..." : "New post"}
          style={{
            width: "2rem",
            height: "2rem",
            background: "#1a1a1a",
            border: `1px solid ${text || file ? "color-mix(in srgb, var(--accent) 50%, #2a2a2a)" : "#2a2a2a"}`,
            borderRadius: "50%",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            padding: 0,
            transition: "border-color 0.2s, box-shadow 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--accent)";
            e.currentTarget.style.boxShadow = "0 0 8px color-mix(in srgb, var(--accent) 30%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = text || file ? "color-mix(in srgb, var(--accent) 50%, #2a2a2a)" : "#2a2a2a";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: "3px", height: "3px", borderRadius: "50%", background: "var(--accent)", opacity: text || file ? 1 : 0.7, animation: text || file ? "none" : `pulse 1.4s ${i * 0.2}s ease-in-out infinite` }} />
          ))}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        attach(e.dataTransfer.files?.[0]);
      }}
      style={{
        width: "100%",
        maxWidth: "32rem",
        marginLeft: "auto",
        background: "#1a1a1a",
        border: `1px solid ${dragOver ? "var(--accent)" : "color-mix(in srgb, var(--accent) 40%, #2a2a2a)"}`,
        borderRadius: "1rem",
        padding: "0.85rem",
        transition: "border-color 0.2s",
      }}
    >
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        }}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder="what's on your mind..."
        rows={2}
        maxLength={2000}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#e5e2e1",
          fontSize: "0.9rem",
          fontFamily: "var(--font-body)",
          resize: "none",
          lineHeight: 1.5,
          maxHeight: "10rem",
          overflowY: "auto",
        }}
      />

      {preview && (
        <div style={{ position: "relative", width: isVideo ? "14rem" : "9rem", marginTop: "0.6rem" }}>
          {isVideo ? (
            <video src={preview} controls playsInline style={{ width: "100%", borderRadius: "6px", display: "block" }} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="preview" style={{ width: "100%", borderRadius: "6px", display: "block" }} />
          )}
          <button
            onClick={removeMedia}
            aria-label="Remove attachment"
            style={{ position: "absolute", top: "-0.5rem", right: "-0.5rem", width: "1.4rem", height: "1.4rem", borderRadius: "50%", background: "#0e0e0e", border: "1px solid #f87171", color: "#f87171", cursor: "pointer", fontSize: "0.7rem", lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginTop: "0.75rem" }}>
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image or video"
          title="Attach image or video"
          style={{ width: "1.9rem", height: "1.9rem", borderRadius: "50%", background: "none", border: "1px solid color-mix(in srgb, var(--accent) 45%, #2a2a2a)", color: "var(--accent)", cursor: "pointer", fontSize: "0.95rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
        >
          ▦
        </button>
        <span style={{ color: "#555", fontSize: "0.68rem" }}>drag, paste, or click to attach</span>
        {error && <span style={{ fontSize: "0.68rem", color: "var(--accent)", marginLeft: "0.25rem" }}>{error}</span>}
        <button
          onClick={handleSubmit}
          disabled={!canPost}
          aria-label="Post"
          style={{ marginLeft: "auto", background: "none", border: "none", color: canPost ? "var(--accent)" : "#333", cursor: canPost ? "pointer" : "default", fontFamily: "var(--font-headline)", fontWeight: 700, letterSpacing: "0.1em", fontSize: "0.8rem" }}
        >
          {posting ? "..." : "POST ↵"}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        onChange={(e) => attach(e.target.files?.[0])}
        style={{ display: "none" }}
      />

      <style>{`
        @keyframes pulse { 0%,80%,100% { opacity:0.3; transform:scale(0.8);} 40% { opacity:1; transform:scale(1.2);} }
      `}</style>
    </div>
  );
}

/* ── Lightbox ───────────────────────────────────────── */
function Lightbox({
  images,
  index,
  onClose,
  onNav,
  onDelete,
}: {
  images: Thought[];
  index: number;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
  onDelete: (id: number) => void;
}) {
  const t = images[index];
  const hasPrev = index > 0;
  const hasNext = index < images.length - 1;
  const isAdmin = typeof window !== "undefined" && !!store("adminToken");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNav(-1);
      if (e.key === "ArrowRight" && hasNext) onNav(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPrev, hasNext, onClose, onNav]);

  if (!t || !t.image) return null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", height: "2px", background: "linear-gradient(90deg, transparent, var(--accent), transparent)", position: "absolute", top: "8%" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: "90vw", maxHeight: "76vh", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <div onClick={() => hasPrev && onNav(-1)} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "15%", cursor: hasPrev ? "w-resize" : "default", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {hasPrev && <span style={{ color: "var(--accent)", fontSize: "2rem", opacity: 0.6, userSelect: "none" }}>‹</span>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${API}${t.image}`} alt={t.content || `Post ${t.id}`} style={{ maxWidth: "100%", maxHeight: "76vh", objectFit: "contain", borderRadius: "4px" }} />
        <div onClick={() => hasNext && onNav(1)} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "15%", cursor: hasNext ? "e-resize" : "default", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {hasNext && <span style={{ color: "var(--accent)", fontSize: "2rem", opacity: 0.6, userSelect: "none" }}>›</span>}
        </div>
      </div>
      {t.content && <p style={{ color: "#aaa", fontSize: "0.8rem", marginTop: "0.75rem", fontStyle: "italic", maxWidth: "42rem", textAlign: "center", padding: "0 1rem" }}>{t.content}</p>}
      {isAdmin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Delete this post?")) onDelete(t.id);
          }}
          style={{ marginTop: "0.75rem", background: "none", border: "1px solid #f8717140", borderRadius: "4px", color: "#f87171", fontSize: "0.75rem", padding: "0.25rem 0.75rem", cursor: "pointer" }}
        >
          delete
        </button>
      )}
      <div style={{ width: "100%", height: "2px", background: "linear-gradient(90deg, transparent, var(--accent), transparent)", position: "absolute", bottom: "8%" }} />
    </div>
  );
}

/* ── Main page ──────────────────────────────────────── */
export default function YapsPage() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [newestId, setNewestId] = useState<number | null>(null);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const images = withImages(thoughts);
  const lightboxIdx = lightboxId === null ? -1 : images.findIndex((t) => t.id === lightboxId);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/thoughts/?page=${p}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setThoughts((prev) => (p === 1 ? data.thoughts : [...prev, ...data.thoughts]));
      setHasNext(data.has_next);
      setPage(data.page);
    } catch {
      if (p === 1) setThoughts(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPage(1);
  }, [fetchPage]);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function handleNewThought(thought: Thought) {
    setNewestId(thought.id);
    setThoughts((prev) => [thought, ...prev]);
    setTimeout(() => setNewestId(null), 500);
  }

  function loadMore() {
    if (!loading && hasNext) fetchPage(page + 1);
  }

  function scrollToTop() {
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  function navLightbox(dir: -1 | 1) {
    const next = lightboxIdx + dir;
    if (next >= 0 && next < images.length) setLightboxId(images[next].id);
  }

  async function handleDelete(id: number) {
    const token = getAdminToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/thoughts/${id}/delete/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setThoughts((prev) => prev.filter((t) => t.id !== id));
        setLightboxId(null);
      } else {
        alert("Failed to delete");
      }
    } catch {
      alert("Failed to delete — check your connection");
    }
  }

  return (
    <>
      <title>Nam yaps</title>

      {lightboxIdx >= 0 && <Lightbox images={images} index={lightboxIdx} onClose={() => setLightboxId(null)} onNav={navLightbox} onDelete={handleDelete} />}

      <div ref={topRef} style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem 6rem", position: "relative", minHeight: "100vh" }}>
        <div style={{ position: "relative", paddingLeft: "3rem" }}>
          {/* Trunk line */}
          <div style={{ position: "absolute", left: TRUNK, top: 0, bottom: 0, width: "1px", background: "linear-gradient(to bottom, #2a2a2a, color-mix(in srgb, var(--accent) 40%, #2a2a2a), #2a2a2a)", boxShadow: "0 0 8px color-mix(in srgb, var(--accent) 20%, transparent)" }} />

          {/* Compose area */}
          <div style={{ position: "relative", marginBottom: "3rem" }}>
            <div style={{ position: "absolute", left: `calc(-3rem + ${TRUNK} - ${HALF_NODE}px)`, top: "0.65rem", width: `${NODE_SIZE}px`, height: `${NODE_SIZE}px`, borderRadius: "50%", background: "#2a2a2a", border: "1.5px solid var(--accent)", zIndex: 2 }} />
            <ComposeCard onPost={handleNewThought} />
            <div style={{ display: "flex", alignItems: "flex-start", marginTop: "0.35rem" }}>
              <div style={{ flexGrow: 1, height: "1px", background: "#2a2a2a" }} />
              <div style={{ width: "1px", height: "8px", background: "#2a2a2a" }} />
            </div>
          </div>

          {/* Sticky scroll-to-top */}
          <div style={{ position: "sticky", top: "4.25rem", zIndex: 10, height: 0, opacity: showScrollTop ? 1 : 0, transition: "opacity 0.3s", pointerEvents: showScrollTop ? "auto" : "none" }}>
            <button
              onClick={scrollToTop}
              aria-label="Scroll to top"
              style={{ position: "absolute", left: `calc(-3rem + ${TRUNK} - 0.6rem)`, top: "-0.6rem", width: "1.2rem", height: "1.2rem", background: "#0e0e0e", border: "1.5px solid var(--accent)", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, color: "var(--accent)", fontSize: "0.55rem", lineHeight: 1, transition: "background 0.2s, box-shadow 0.2s, transform 0.2s" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent)";
                e.currentTarget.style.boxShadow = "0 0 12px var(--accent)";
                e.currentTarget.style.color = "#0e0e0e";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#0e0e0e";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.color = "var(--accent)";
              }}
            >
              ▲
            </button>
          </div>

          {/* Entries */}
          {thoughts.map((thought) => (
            <div key={thought.id} className={thought.id === newestId ? "thought-new" : ""} style={{ position: "relative", marginBottom: "3rem" }}>
              <div style={{ position: "absolute", left: `calc(-3rem + ${TRUNK} - ${HALF_NODE}px)`, top: "0.1rem", width: `${NODE_SIZE}px`, height: `${NODE_SIZE}px`, borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 10px var(--accent)", zIndex: 2 }} />

              {thought.content && (
                <p style={{ fontSize: "1rem", lineHeight: 1.7, color: "#e5e2e1", fontWeight: 300 }}>{thought.content}</p>
              )}

              {thought.image && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: thought.content ? "0.7rem" : 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API}${thought.image}`}
                    alt={thought.content || `Post ${thought.id}`}
                    loading="lazy"
                    onClick={() => setLightboxId(thought.id)}
                    style={{ maxWidth: "100%", height: "auto", borderRadius: "6px", cursor: "pointer", display: "block" }}
                  />
                </div>
              )}

              {thought.video && (
                <div style={{ display: "flex", justifyContent: "center", marginTop: thought.content ? "0.7rem" : 0 }}>
                  <video
                    src={`${API}${thought.video}`}
                    controls
                    playsInline
                    preload="metadata"
                    style={{ maxWidth: "100%", height: "auto", borderRadius: "6px", display: "block" }}
                  />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.4rem" }}>
                <span style={{ fontFamily: "var(--font-headline)", fontSize: "0.65rem", color: "#555", letterSpacing: "0.15em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {formatDate(thought.created_at)}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "flex-start", marginTop: "0.35rem" }}>
                <div style={{ flexGrow: 1, height: "1px", background: "#2a2a2a" }} />
                <div style={{ width: "1px", height: "8px", background: "#2a2a2a" }} />
              </div>
            </div>
          ))}

          {/* Load more */}
          {hasNext && (
            <button onClick={loadMore} disabled={loading} aria-label="Load more" style={{ position: "absolute", left: `calc(${TRUNK} - 3px)`, background: "none", border: "none", cursor: loading ? "wait" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.35rem", padding: "0.5rem 0.75rem", zIndex: 2 }}>
              {[1, 0.6, 0.3].map((opacity, i) => (
                <div key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", opacity }} />
              ))}
            </button>
          )}
        </div>

        <div style={{ textAlign: "right", marginTop: "4rem", paddingRight: "0.5rem" }}>
          <span style={{ fontStyle: "italic", color: "#555", fontSize: "0.85rem", letterSpacing: "0.02em" }}>sometimes, some of my neurons fire</span>
        </div>
      </div>

      <style>{`
        @keyframes thoughtSlideIn { from { opacity:0; transform:translateY(-1rem);} to { opacity:1; transform:translateY(0);} }
        .thought-new { animation: thoughtSlideIn 0.4s ease-out; }
      `}</style>
    </>
  );
}
