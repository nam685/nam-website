"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API } from "@/lib/api";

const COOLDOWN_MS = 60 * 60 * 1000; // 1h matches server
const MAX_LENGTH = 2000;

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Focus textarea when opening
  useEffect(() => {
    if (open && status === "idle") {
      setTimeout(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
        }
      }, 150);
    }
  }, [open, status]);

  const isCoolingDown = useCallback(() => {
    if (typeof window === "undefined") return false;
    const last = localStorage.getItem("lastFeedbackTime");
    if (!last) return false;
    return Date.now() - Number(last) < COOLDOWN_MS;
  }, []);

  function handleOpen() {
    if (isCoolingDown()) {
      setOpen(true);
      setStatus("sent");
      return;
    }
    setOpen(true);
    setStatus("idle");
  }

  async function handleSubmit() {
    const message = text.trim();
    if (!message || posting) return;

    setPosting(true);
    setErrorMsg("");
    try {
      const res = await fetch(`${API}/api/feedback/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.status === 429) {
        const data = await res.json();
        setErrorMsg(data.error || "Too many requests");
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error || "Failed");
        return;
      }
      localStorage.setItem("lastFeedbackTime", String(Date.now()));
      setText("");
      setStatus("sent");
    } catch {
      setErrorMsg("Network error");
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
      setOpen(false);
    }
  }

  function handleClose() {
    setOpen(false);
    if (status === "sent") {
      setStatus("idle");
    }
  }

  return (
    <>
      <div
        ref={wrapperRef}
        style={{
          position: "fixed",
          bottom: "1.5rem",
          right: "1.5rem",
          zIndex: 150,
        }}
      >
        {open ? (
          <div
            style={{
              width: "min(22rem, calc(100vw - 3rem))",
              background: "#131313",
              border: "1px solid color-mix(in srgb, var(--accent, #888) 40%, #2a2a2a)",
              borderRadius: "1rem",
              padding: "0.75rem",
              animation: "feedbackSlideUp 0.25s ease-out",
            }}
          >
            {status === "sent" ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "0.75rem 0",
                }}
              >
                <p
                  style={{
                    color: "var(--accent, #888)",
                    fontFamily: "var(--font-headline)",
                    fontSize: "0.85rem",
                    letterSpacing: "0.08em",
                    margin: 0,
                  }}
                >
                  thanks for the feedback
                </p>
                <button
                  onClick={handleClose}
                  style={{
                    marginTop: "0.5rem",
                    background: "none",
                    border: "none",
                    color: "#666",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    fontFamily: "var(--font-body)",
                  }}
                >
                  close
                </button>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--accent, #888)",
                      fontFamily: "var(--font-headline)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    feedback
                  </span>
                  <button
                    onClick={handleClose}
                    aria-label="Close feedback"
                    style={{
                      background: "none",
                      border: "none",
                      color: "#666",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      padding: "0 0.25rem",
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    gap: "0.5rem",
                    background: "#1a1a1a",
                    border: "1px solid color-mix(in srgb, var(--accent, #888) 25%, #2a2a2a)",
                    borderRadius: "0.75rem",
                    padding: "0.35rem 0.5rem",
                  }}
                >
                  <textarea
                    ref={inputRef}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value);
                      const el = e.target;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="what do you think..."
                    rows={1}
                    maxLength={MAX_LENGTH}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      color: "#e5e2e1",
                      fontSize: "0.85rem",
                      fontFamily: "var(--font-body)",
                      resize: "none",
                      lineHeight: 1.4,
                      maxHeight: "6rem",
                      overflowY: "auto",
                    }}
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={posting || !text.trim()}
                    aria-label="Send feedback"
                    style={{
                      background: "none",
                      border: "none",
                      color: posting || !text.trim() ? "#333" : "var(--accent, #888)",
                      cursor: posting || !text.trim() ? "default" : "pointer",
                      fontSize: "0.85rem",
                      fontFamily: "var(--font-headline)",
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      flexShrink: 0,
                      transition: "color 0.2s",
                      padding: "0.2rem 0",
                    }}
                  >
                    {posting ? "..." : "↵"}
                  </button>
                </div>

                {errorMsg && (
                  <p
                    style={{
                      fontSize: "0.7rem",
                      color: "var(--accent, #888)",
                      fontFamily: "var(--font-headline)",
                      letterSpacing: "0.08em",
                      margin: "0.35rem 0 0",
                    }}
                  >
                    {errorMsg}
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <button
            onClick={handleOpen}
            aria-label="Send feedback"
            title="Send feedback"
            style={{
              width: "2.5rem",
              height: "2.5rem",
              background: "#131313",
              border: "1px solid #2a2a2a",
              borderRadius: "50%",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "border-color 0.2s, box-shadow 0.2s",
              color: "#666",
              fontSize: "1rem",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent, #888)";
              e.currentTarget.style.boxShadow =
                "0 0 10px color-mix(in srgb, var(--accent, #888) 25%, transparent)";
              e.currentTarget.style.color = "var(--accent, #888)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#2a2a2a";
              e.currentTarget.style.boxShadow = "none";
              e.currentTarget.style.color = "#666";
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}
      </div>

      <style>{`
        @keyframes feedbackSlideUp {
          from { opacity: 0; transform: translateY(0.5rem); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
