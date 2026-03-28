"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Thought {
  id: number;
  content: string;
  created_at: string;
}

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const COOLDOWN_MS = 18 * 60 * 60 * 1000; // 18h

const FALLBACK: Thought[] = [
  {
    id: 0,
    content: "This is my public diary. Certified 100% human generated.",
    created_at: "2026-03-28T00:00:00Z",
  },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA");
}

/* Trunk geometry */
const TRUNK = "1.25rem";
const NODE_SIZE = 10;
const HALF_NODE = NODE_SIZE / 2;

/* ── localStorage helpers (SSR-safe) ────────────────── */
function store(key: string, val?: string): string | null {
  if (typeof window === "undefined") return null;
  if (val !== undefined) {
    localStorage.setItem(key, val);
    return val;
  }
  return localStorage.getItem(key);
}

function storeDel(key: string) {
  if (typeof window !== "undefined") localStorage.removeItem(key);
}

/* ── Compose sprite ─────────────────────────────────── */
function ComposeSprite({ onPost }: { onPost: (t: Thought) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click-outside — keep text cached
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false); // text stays cached
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function isCoolingDown() {
    const last = store("lastThoughtTime");
    if (!last) return false;
    return Date.now() - Number(last) < COOLDOWN_MS;
  }

  function cooldownRemaining(): string {
    const last = Number(store("lastThoughtTime") || 0);
    const remaining = COOLDOWN_MS - (Date.now() - last);
    if (remaining <= 0) return "";
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  function getToken(): string | null {
    let token = store("thoughtToken");
    if (!token) {
      token = prompt("Enter thought token:");
      if (token) store("thoughtToken", token);
    }
    return token;
  }

  function handleOpen() {
    if (isCoolingDown()) {
      setError(`Cooldown: ${cooldownRemaining()}`);
      setTimeout(() => setError(""), 3000);
      return;
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 150);
  }

  async function handleSubmit() {
    const content = text.trim();
    if (!content || posting) return;

    const token = getToken();
    if (!token) return;

    setPosting(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/thoughts/create/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });
      if (res.status === 401) {
        storeDel("thoughtToken");
        setError("Bad token — cleared, try again");
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed");
        return;
      }
      const thought: Thought = await res.json();
      store("lastThoughtTime", String(Date.now()));
      onPost(thought);
      setText("");
      setOpen(false);
    } catch {
      setError("Network error");
    } finally {
      setPosting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setOpen(false); // text stays cached
    }
  }

  return (
    <div
      ref={wrapperRef}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      {error && (
        <span
          style={{
            fontSize: "0.7rem",
            color: "var(--accent)",
            fontFamily: "var(--font-headline)",
            letterSpacing: "0.08em",
            whiteSpace: "nowrap",
          }}
        >
          {error}
        </span>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          overflow: "hidden",
          transition: "width 0.35s cubic-bezier(0.4,0,0.2,1)",
          width: open ? "min(28rem, calc(100vw - 8rem))" : "2rem",
          height: "2rem",
          background: open ? "#1a1a1a" : "none",
          border: open
            ? "1px solid color-mix(in srgb, var(--accent) 40%, #2a2a2a)"
            : "1px solid transparent",
          borderRadius: open ? "1rem" : "50%",
        }}
      >
        {open ? (
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="what's on your mind..."
            rows={1}
            maxLength={2000}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#e5e2e1",
              fontSize: "0.85rem",
              fontFamily: "var(--font-body)",
              padding: "0.35rem 0.5rem",
              resize: "none",
              lineHeight: 1.4,
            }}
          />
        ) : (
          <button
            onClick={handleOpen}
            aria-label="New thought"
            title={
              isCoolingDown()
                ? `Cooldown: ${cooldownRemaining()}`
                : text
                  ? "Continue editing..."
                  : "New thought"
            }
            style={{
              width: "2rem",
              height: "2rem",
              background: "#1a1a1a",
              border: `1px solid ${text ? "color-mix(in srgb, var(--accent) 50%, #2a2a2a)" : "#2a2a2a"}`,
              borderRadius: "50%",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "3px",
              padding: 0,
              transition: "border-color 0.2s, box-shadow 0.2s, background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.boxShadow =
                "0 0 8px color-mix(in srgb, var(--accent) 30%, transparent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = text
                ? "color-mix(in srgb, var(--accent) 50%, #2a2a2a)"
                : "#2a2a2a";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: "3px",
                  height: "3px",
                  borderRadius: "50%",
                  background: "var(--accent)",
                  opacity: text ? 1 : 0.7,
                  animation: text
                    ? "none"
                    : `pulse 1.4s ${i * 0.2}s ease-in-out infinite`,
                }}
              />
            ))}
          </button>
        )}

        {open && (
          <button
            onClick={handleSubmit}
            disabled={posting || !text.trim()}
            aria-label="Post thought"
            style={{
              background: "none",
              border: "none",
              color: posting || !text.trim() ? "#333" : "var(--accent)",
              cursor: posting || !text.trim() ? "default" : "pointer",
              padding: "0 0.5rem",
              fontSize: "0.85rem",
              fontFamily: "var(--font-headline)",
              fontWeight: 700,
              letterSpacing: "0.1em",
              transition: "color 0.2s",
              flexShrink: 0,
            }}
          >
            {posting ? "..." : "↵"}
          </button>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes thoughtSlideIn {
          from { opacity: 0; transform: translateY(-1rem); }
          to { opacity: 1; transform: translateY(0); }
        }
        .thought-new {
          animation: thoughtSlideIn 0.4s ease-out;
        }
      `}</style>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────── */
export default function ThinksPage() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [newestId, setNewestId] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/thoughts/?page=${p}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setThoughts((prev) =>
        p === 1 ? data.thoughts : [...prev, ...data.thoughts],
      );
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

  return (
    <>
      <title>Thinks | Nam Le</title>
      <div
        ref={topRef}
        style={{
          maxWidth: "64rem",
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
          position: "relative",
          minHeight: "100vh",
        }}
      >
        {/* Timeline container — trunk starts at very top */}
        <div
          style={{
            position: "relative",
            paddingLeft: "3rem",
          }}
        >
          {/* Trunk line */}
          <div
            style={{
              position: "absolute",
              left: TRUNK,
              top: 0,
              bottom: 0,
              width: "1px",
              background:
                "linear-gradient(to bottom, #2a2a2a, color-mix(in srgb, var(--accent) 40%, #2a2a2a), #2a2a2a)",
              boxShadow:
                "0 0 8px color-mix(in srgb, var(--accent) 20%, transparent)",
            }}
          />

          {/* Compose area — sits at the top of the trunk like first entry */}
          <div
            style={{
              position: "relative",
              marginBottom: "3rem",
            }}
          >
            {/* Fork joint for compose */}
            <div
              style={{
                position: "absolute",
                left: `calc(-3rem + ${TRUNK} - ${HALF_NODE}px)`,
                top: "0.65rem",
                width: `${NODE_SIZE}px`,
                height: `${NODE_SIZE}px`,
                borderRadius: "50%",
                background: "#2a2a2a",
                border: "1.5px solid var(--accent)",
                zIndex: 2,
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
              }}
            >
              <ComposeSprite onPost={handleNewThought} />
            </div>
            {/* Branch line under compose */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                marginTop: "0.35rem",
              }}
            >
              <div
                style={{ flexGrow: 1, height: "1px", background: "#2a2a2a" }}
              />
              <div
                style={{ width: "1px", height: "8px", background: "#2a2a2a" }}
              />
            </div>
          </div>

          {/* Sticky scroll-to-top on trunk */}
          <div
            style={{
              position: "sticky",
              top: "4.25rem",
              zIndex: 10,
              height: 0,
              opacity: showScrollTop ? 1 : 0,
              transition: "opacity 0.3s",
              pointerEvents: showScrollTop ? "auto" : "none",
            }}
          >
            <button
              onClick={scrollToTop}
              aria-label="Scroll to top"
              style={{
                position: "absolute",
                left: `calc(-3rem + ${TRUNK} - 0.6rem)`,
                top: "-0.6rem",
                width: "1.2rem",
                height: "1.2rem",
                background: "#0e0e0e",
                border: "1.5px solid var(--accent)",
                borderRadius: "50%",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                color: "var(--accent)",
                fontSize: "0.55rem",
                lineHeight: 1,
                transition: "background 0.2s, box-shadow 0.2s, transform 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--accent)";
                e.currentTarget.style.boxShadow = "0 0 12px var(--accent)";
                e.currentTarget.style.color = "#0e0e0e";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#0e0e0e";
                e.currentTarget.style.boxShadow = "none";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.transform = "none";
              }}
            >
              ▲
            </button>
          </div>

          {/* Thought entries */}
          {thoughts.map((thought) => (
            <div
              key={thought.id}
              className={thought.id === newestId ? "thought-new" : ""}
              style={{
                position: "relative",
                marginBottom: "3rem",
              }}
            >
              {/* Fork joint */}
              <div
                style={{
                  position: "absolute",
                  left: `calc(-3rem + ${TRUNK} - ${HALF_NODE}px)`,
                  top: "0.1rem",
                  width: `${NODE_SIZE}px`,
                  height: `${NODE_SIZE}px`,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  boxShadow: "0 0 10px var(--accent)",
                  zIndex: 2,
                }}
              />

              {/* Content above branch */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  gap: "1.5rem",
                  marginBottom: "0.35rem",
                }}
              >
                <p
                  style={{
                    fontSize: "1rem",
                    lineHeight: 1.7,
                    color: "#e5e2e1",
                    fontWeight: 300,
                    maxWidth: "42rem",
                  }}
                >
                  {thought.content}
                </p>
                <span
                  style={{
                    fontFamily: "var(--font-headline)",
                    fontSize: "0.65rem",
                    color: "#555",
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    paddingBottom: "0.15rem",
                  }}
                >
                  {formatDate(thought.created_at)}
                </span>
              </div>

              {/* Branch line with hook */}
              <div style={{ display: "flex", alignItems: "flex-start" }}>
                <div
                  style={{
                    flexGrow: 1,
                    height: "1px",
                    background: "#2a2a2a",
                  }}
                />
                <div
                  style={{
                    width: "1px",
                    height: "8px",
                    background: "#2a2a2a",
                  }}
                />
              </div>
            </div>
          ))}

          {/* Load more dots — on trunk */}
          {hasNext && (
            <button
              onClick={loadMore}
              disabled={loading}
              aria-label="Load more thoughts"
              style={{
                position: "absolute",
                left: `calc(${TRUNK} - 3px)`,
                background: "none",
                border: "none",
                cursor: loading ? "wait" : "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.5rem 0.75rem",
                zIndex: 2,
              }}
            >
              {[1, 0.6, 0.3].map((opacity, i) => (
                <div
                  key={i}
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "var(--accent)",
                    boxShadow: "0 0 8px var(--accent)",
                    opacity,
                  }}
                />
              ))}
            </button>
          )}
        </div>

        {/* Tagline — bottom right */}
        <div
          style={{
            textAlign: "right",
            marginTop: "4rem",
            paddingRight: "0.5rem",
          }}
        >
          <span
            style={{
              fontStyle: "italic",
              color: "#555",
              fontSize: "0.85rem",
              letterSpacing: "0.02em",
            }}
          >
            sometimes, some of my neurons fire
          </span>
        </div>
      </div>
    </>
  );
}
