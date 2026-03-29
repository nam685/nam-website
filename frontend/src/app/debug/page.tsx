"use client";

import { useEffect, useRef, useState } from "react";
import { API } from "@/lib/api";
import { getAdminToken, peekAdminToken } from "@/lib/auth";

interface UploadedFile {
  name: string;
  url: string;
  time: string;
}

export default function DebugPage() {
  const [authed, setAuthed] = useState(false);
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!peekAdminToken()) {
      window.location.href = `/sudo?from=${encodeURIComponent(window.location.pathname)}`;
      return;
    }
    setAuthed(true);
    fetchUploads();
  }, []);

  async function fetchUploads() {
    try {
      const token = peekAdminToken();
      const res = await fetch(`${API}/api/debug/uploads/`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setUploads(await res.json());
    } catch {
      /* ignore */
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;

    const token = getAdminToken();
    if (!token) return;

    setUploading(true);
    setMessage("");

    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);

      try {
        const res = await fetch(`${API}/api/debug/upload/`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (res.ok) {
          const data = await res.json();
          setUploads((prev) => [data, ...prev]);
        } else {
          const data = await res.json();
          setMessage(data.error || "Upload failed");
        }
      } catch {
        setMessage("Network error");
      }
    }

    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (!authed) return null;

  return (
    <>
      <title>Nam debugs</title>
      <div
        style={{
          maxWidth: "48rem",
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "2rem",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.7rem",
              color: "#555",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            debug console
          </span>
          <div style={{ flex: 1, height: "1px", background: "#2a2a2a" }} />
        </div>

        {/* Upload section */}
        <section style={{ marginBottom: "3rem" }}>
          <h2
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.75rem",
              color: "var(--accent)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "1rem",
            }}
          >
            Upload files
          </h2>

          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.log,.json"
            onChange={handleUpload}
            style={{ display: "none" }}
          />

          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.75rem",
              color: "var(--accent)",
              background: "none",
              border: "1px solid var(--accent)",
              padding: "0.5rem 1.25rem",
              cursor: uploading ? "wait" : "pointer",
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
            {uploading ? "Uploading..." : "Choose files"}
          </button>

          {message && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#ff4444",
                marginTop: "0.5rem",
              }}
            >
              {message}
            </p>
          )}

          {uploads.length > 0 && (
            <div style={{ marginTop: "1.5rem" }}>
              {uploads.map((f) => (
                <div
                  key={f.url + f.time}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem 0",
                    borderBottom: "1px solid #1a1a1a",
                  }}
                >
                  {f.name.match(/\.(png|jpg|jpeg|gif|webp)$/i) ? (
                    <img
                      src={f.url}
                      alt={f.name}
                      style={{
                        width: "3rem",
                        height: "3rem",
                        objectFit: "cover",
                        borderRadius: "4px",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "3rem",
                        height: "3rem",
                        background: "#1a1a1a",
                        borderRadius: "4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.6rem",
                        color: "#555",
                        flexShrink: 0,
                      }}
                    >
                      FILE
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "0.8rem",
                        color: "#e5e2e1",
                        textDecoration: "none",
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name}
                    </a>
                    <span style={{ fontSize: "0.65rem", color: "#555" }}>
                      {new Date(f.time).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Quick info */}
        <section>
          <h2
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.75rem",
              color: "var(--accent)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: "1rem",
            }}
          >
            Info
          </h2>
          <div
            style={{
              fontSize: "0.8rem",
              color: "#888",
              lineHeight: 2,
              fontFamily: "var(--font-body)",
            }}
          >
            <div>
              API:{" "}
              <span style={{ color: "#e5e2e1" }}>{API || "(relative)"}</span>
            </div>
            <div>
              Token:{" "}
              <span style={{ color: "#e5e2e1" }}>
                {peekAdminToken() ? "present" : "none"}
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
