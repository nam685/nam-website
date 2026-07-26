import { useEffect, useState } from "react";
import { API } from "./api";

/* ── localStorage helpers (SSR-safe) ───────────────────── */

export function store(key: string, val?: string): string | null {
  if (typeof window === "undefined") return null;
  if (val !== undefined) {
    localStorage.setItem(key, val);
    return val;
  }
  return localStorage.getItem(key);
}

export function storeDel(key: string) {
  if (typeof window !== "undefined") localStorage.removeItem(key);
}

/* ── Auth helpers ──────────────────────────────────────── */

/** Returns token if present, otherwise redirects to /sudo */
export function getAdminToken(): string | null {
  const token = store("adminToken");
  if (token) return token;
  if (typeof window !== "undefined") {
    window.location.href = `/sudo?from=${encodeURIComponent(window.location.pathname)}`;
  }
  return null;
}

/**
 * React hook: true only once the stored admin token is *server-validated*.
 *
 * Starts false (so SSR and first paint never expose admin controls), then confirms the token
 * against /api/auth/check/. The endpoint always returns HTTP 200 with `{authenticated: bool}`, so
 * a mere presence check (or checking `res.ok`) would treat any leftover/expired token as admin —
 * we must read the body. Use this to gate admin-only UI; the backend `@require_admin` remains the
 * real security boundary.
 */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    const token = store("adminToken");
    if (!token) return;
    let cancelled = false;
    fetch(`${API}/api/auth/check/`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setIsAdmin(d?.authenticated === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return isAdmin;
}

/** Fetch a short-lived nonce for OAuth redirects (keeps admin token out of URLs). */
export async function fetchAdminNonce(): Promise<string | null> {
  const token = store("adminToken");
  if (!token) return null;
  const res = await fetch("/api/auth/nonce/", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.nonce ?? null;
}
