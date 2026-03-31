"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { API } from "@/lib/api";
import { store, storeDel } from "@/lib/auth";

function SudoForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawFrom = searchParams.get("from") || "/";
  const from = rawFrom.startsWith("/") && !rawFrom.startsWith("//") ? rawFrom : "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = store("adminToken");
    if (token) {
      fetch(`${API}/api/auth/check/`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.authenticated) setAuthed(true);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/api/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: password }),
      });

      if (!res.ok) {
        setError("Don't guess.");
        setPassword("");
        setLoading(false);
        return;
      }

      const data = await res.json();
      store("adminToken", data.token);
      router.push(from);
    } catch {
      setError("Network error");
      setLoading(false);
    }
  }

  function handleLogout() {
    storeDel("adminToken");
    setAuthed(false);
  }

  return (
    <div
      style={{
        minHeight: "calc(100vh - 3.5rem)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "20rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
        }}
      >
        {/* Terminal prompt */}
        <div>
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.7rem",
              color: "#555",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            {authed ? "session active" : "authentication required"}
          </span>
        </div>

        {authed ? (
          <>
            <p
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "0.85rem",
                color: "var(--accent)",
                letterSpacing: "0.08em",
              }}
            >
              You&apos;re in.
            </p>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
              <button
                onClick={() => router.push(from)}
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.75rem",
                  color: "var(--accent)",
                  background: "none",
                  border: `1px solid var(--accent)`,
                  padding: "0.4rem 1rem",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  transition: "background 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background =
                    "color-mix(in srgb, var(--accent) 15%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                }}
              >
                Back
              </button>
              <button
                onClick={handleLogout}
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.75rem",
                  color: "#555",
                  background: "none",
                  border: "1px solid #333",
                  padding: "0.4rem 1rem",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  transition: "color 0.2s, border-color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#aaa";
                  e.currentTarget.style.borderColor = "#555";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#555";
                  e.currentTarget.style.borderColor = "#333";
                }}
              >
                Logout
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                borderBottom: `1px solid ${error ? "#ff4444" : "var(--accent)"}`,
                paddingBottom: "0.5rem",
                transition: "border-color 0.3s",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.85rem",
                  color: "var(--accent)",
                  letterSpacing: "0.05em",
                  flexShrink: 0,
                  transition: "color 0.4s",
                }}
              >
                $
              </span>
              <input
                ref={inputRef}
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError("");
                }}
                placeholder="enter password"
                autoComplete="off"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#e5e2e1",
                  fontSize: "0.85rem",
                  fontFamily: "var(--font-body)",
                  padding: 0,
                  letterSpacing: "0.02em",
                }}
              />
            </div>

            {error && (
              <p
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.75rem",
                  color: "#ff4444",
                  letterSpacing: "0.1em",
                  marginTop: "0.75rem",
                }}
              >
                {error}
              </p>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "1.5rem",
              }}
            >
              <button
                type="button"
                onClick={() => router.push(from)}
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.7rem",
                  color: "#555",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  padding: 0,
                  transition: "color 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#aaa";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#555";
                }}
              >
                ← Back
              </button>

              <button
                type="submit"
                disabled={loading || !password.trim()}
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.75rem",
                  color: loading || !password.trim() ? "#333" : "var(--accent)",
                  background: "none",
                  border: `1px solid ${loading || !password.trim() ? "#222" : "var(--accent)"}`,
                  padding: "0.4rem 1rem",
                  cursor: loading || !password.trim() ? "default" : "pointer",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  transition: "all 0.2s",
                }}
              >
                {loading ? "..." : "Enter"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function SudoPage() {
  return (
    <>
      <title>Nam sudo</title>
      <Suspense fallback={<div style={{ minHeight: "200px" }} />}>
        <SudoForm />
      </Suspense>
    </>
  );
}
