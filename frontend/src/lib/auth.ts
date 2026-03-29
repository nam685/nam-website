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
