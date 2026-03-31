"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type Drawing, API } from "@/lib/api";
import { getAdminToken, store } from "@/lib/auth";

const PURPLE = "#a855f7";

/* ── Upload button ──────────────────────────────────── */
function UploadButton({
  category,
  onUpload,
}: {
  category: "pencil" | "camera";
  onUpload: (d: Drawing) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = getAdminToken();
    if (!token) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("category", category);

      const res = await fetch(`${API}/api/drawings/upload/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (res.ok) {
        const drawing: Drawing = await res.json();
        onUpload(drawing);
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error ?? `Upload failed (${res.status})`);
      }
    } catch {
      alert("Upload failed — check your connection");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <button
      type="button"
      onClick={() => fileRef.current?.click()}
      disabled={uploading}
      style={{
        background: "none",
        border: `1px solid ${PURPLE}40`,
        borderRadius: "50%",
        width: "1.75rem",
        height: "1.75rem",
        cursor: uploading ? "wait" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: PURPLE,
        fontSize: "0.9rem",
        transition: "border-color 0.2s, background 0.2s",
        flexShrink: 0,
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = PURPLE;
        e.currentTarget.style.background = `${PURPLE}15`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = `${PURPLE}40`;
        e.currentTarget.style.background = "none";
      }}
      title={`Upload ${category}`}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        style={{
          position: "absolute",
          width: 0,
          height: 0,
          overflow: "hidden",
          opacity: 0,
        }}
      />
      {uploading ? "..." : "+"}
    </button>
  );
}

/* ── Lightbox ───────────────────────────────────────── */
function Lightbox({
  drawings,
  index,
  onClose,
  onNav,
  onDelete,
}: {
  drawings: Drawing[];
  index: number;
  onClose: () => void;
  onNav: (dir: -1 | 1) => void;
  onDelete: (id: number) => void;
}) {
  const d = drawings[index];
  const hasPrev = index > 0;
  const hasNext = index < drawings.length - 1;
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

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.92)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Top separator */}
      <div
        style={{
          width: "100%",
          height: "2px",
          background: `linear-gradient(90deg, transparent, ${PURPLE}, transparent)`,
          position: "absolute",
          top: "8%",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          maxWidth: "90vw",
          maxHeight: "76vh",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left nav zone */}
        <div
          onClick={() => hasPrev && onNav(-1)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: "15%",
            cursor: hasPrev ? "w-resize" : "default",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hasPrev && (
            <span
              style={{
                color: PURPLE,
                fontSize: "2rem",
                opacity: 0.6,
                userSelect: "none",
              }}
            >
              ‹
            </span>
          )}
        </div>

        {/* Image */}
        <img
          src={`${API}${d.image}`}
          alt={d.caption || `Drawing ${d.id}`}
          style={{
            maxWidth: "100%",
            maxHeight: "76vh",
            objectFit: "contain",
            borderRadius: "4px",
          }}
        />

        {/* Right nav zone */}
        <div
          onClick={() => hasNext && onNav(1)}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "15%",
            cursor: hasNext ? "e-resize" : "default",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {hasNext && (
            <span
              style={{
                color: PURPLE,
                fontSize: "2rem",
                opacity: 0.6,
                userSelect: "none",
              }}
            >
              ›
            </span>
          )}
        </div>
      </div>

      {/* Caption */}
      {d.caption && (
        <p
          style={{
            color: "#aaa",
            fontSize: "0.8rem",
            marginTop: "0.75rem",
            fontStyle: "italic",
          }}
        >
          {d.caption}
        </p>
      )}

      {/* Delete button (admin only) */}
      {isAdmin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm("Delete this drawing?")) onDelete(d.id);
          }}
          style={{
            marginTop: "0.75rem",
            background: "none",
            border: `1px solid #f8717140`,
            borderRadius: "4px",
            color: "#f87171",
            fontSize: "0.75rem",
            padding: "0.25rem 0.75rem",
            cursor: "pointer",
            transition: "background 0.2s, border-color 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#f87171";
            e.currentTarget.style.background = "#f8717115";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#f8717140";
            e.currentTarget.style.background = "none";
          }}
        >
          delete
        </button>
      )}

      {/* Bottom separator */}
      <div
        style={{
          width: "100%",
          height: "2px",
          background: `linear-gradient(90deg, transparent, ${PURPLE}, transparent)`,
          position: "absolute",
          bottom: "8%",
        }}
      />
    </div>
  );
}

/* ── Image column ───────────────────────────────────── */
function ImageColumn({
  drawings,
  allDrawings,
  onSelect,
}: {
  drawings: Drawing[];
  allDrawings: Drawing[];
  onSelect: (globalIndex: number) => void;
}) {
  return (
    <div
      style={{
        columns: "2 200px",
        columnGap: "0.75rem",
      }}
    >
      {drawings.map((d) => {
        const globalIdx = allDrawings.findIndex((ad) => ad.id === d.id);
        return (
          <div
            key={d.id}
            onClick={() => onSelect(globalIdx)}
            style={{
              breakInside: "avoid",
              marginBottom: "0.75rem",
              cursor: "pointer",
              borderRadius: "4px",
              overflow: "hidden",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "scale(1.02)";
              e.currentTarget.style.boxShadow = `0 0 20px ${PURPLE}30`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            <img
              src={`${API}${d.image}`}
              alt={d.caption || `Drawing ${d.id}`}
              loading="lazy"
              style={{
                width: "100%",
                display: "block",
                borderRadius: "4px",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────── */
export default function DrawsPage() {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [mobileSide, setMobileSide] = useState<"pencil" | "camera">("pencil");

  const pencil = drawings.filter((d) => d.category === "pencil");
  const camera = drawings.filter((d) => d.category === "camera");

  const fetchDrawings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/drawings/`);
      if (res.ok) setDrawings(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchDrawings();
  }, [fetchDrawings]);

  function handleUpload(d: Drawing) {
    setDrawings((prev) => [d, ...prev]);
  }

  function handleLightboxNav(dir: -1 | 1) {
    if (lightboxIdx === null) return;
    const next = lightboxIdx + dir;
    if (next >= 0 && next < drawings.length) setLightboxIdx(next);
  }

  async function handleDelete(id: number) {
    const token = getAdminToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/drawings/${id}/delete/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDrawings((prev) => prev.filter((d) => d.id !== id));
        setLightboxIdx(null);
      } else {
        alert("Failed to delete");
      }
    } catch {
      alert("Failed to delete — check your connection");
    }
  }

  return (
    <>
      <title>Nam draws</title>

      {lightboxIdx !== null && (
        <Lightbox
          drawings={drawings}
          index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onNav={handleLightboxNav}
          onDelete={handleDelete}
        />
      )}

      {/* ── Desktop layout ─────────────────────────── */}
      <div className="draws-desktop">
        <div
          style={{
            maxWidth: "72rem",
            margin: "0 auto",
            padding: "2rem 1.5rem 6rem",
            position: "relative",
          }}
        >
          {/* Headers */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              marginBottom: "2rem",
              position: "relative",
            }}
          >
            {/* Left header */}
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: "0.5rem",
                paddingRight: "1.5rem",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.8rem",
                  color: PURPLE,
                  letterSpacing: "0.12em",
                  textTransform: "lowercase",
                  textAlign: "left",
                  lineHeight: 1.3,
                  whiteSpace: "pre-line",
                }}
              >
                {"with\npencil"}
              </span>
              <UploadButton category="pencil" onUpload={handleUpload} />
            </div>

            {/* Center line dot */}
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: PURPLE,
                boxShadow: `0 0 12px ${PURPLE}`,
                flexShrink: 0,
                alignSelf: "center",
              }}
            />

            {/* Right header */}
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                gap: "0.5rem",
                paddingLeft: "1.5rem",
              }}
            >
              <UploadButton category="camera" onUpload={handleUpload} />
              <span
                style={{
                  fontFamily: "var(--font-headline)",
                  fontSize: "0.8rem",
                  color: PURPLE,
                  letterSpacing: "0.12em",
                  textTransform: "lowercase",
                  textAlign: "right",
                  lineHeight: 1.3,
                  whiteSpace: "pre-line",
                }}
              >
                {"with\ncamera"}
              </span>
            </div>
          </div>

          {/* Split view */}
          <div style={{ display: "flex", position: "relative" }}>
            {/* Left: pencil */}
            <div
              className="draws-hide-scrollbar"
              style={{
                flex: 1,
                maxHeight: "calc(100vh - 10rem)",
                overflowY: "auto",
                paddingRight: "1.5rem",
              }}
            >
              {pencil.length > 0 ? (
                <ImageColumn
                  drawings={pencil}
                  allDrawings={drawings}
                  onSelect={setLightboxIdx}
                />
              ) : (
                <p
                  style={{
                    color: "#555",
                    fontStyle: "italic",
                    fontSize: "0.85rem",
                    textAlign: "right",
                  }}
                >
                  no pencil drawings yet
                </p>
              )}
            </div>

            {/* Center divider */}
            <div
              style={{
                width: "1px",
                background: `linear-gradient(to bottom, ${PURPLE}, ${PURPLE}40, transparent)`,
                boxShadow: `0 0 8px ${PURPLE}30`,
                flexShrink: 0,
              }}
            />

            {/* Right: camera */}
            <div
              className="draws-hide-scrollbar"
              style={{
                flex: 1,
                maxHeight: "calc(100vh - 10rem)",
                overflowY: "auto",
                paddingLeft: "1.5rem",
              }}
            >
              {camera.length > 0 ? (
                <ImageColumn
                  drawings={camera}
                  allDrawings={drawings}
                  onSelect={setLightboxIdx}
                />
              ) : (
                <p
                  style={{
                    color: "#555",
                    fontStyle: "italic",
                    fontSize: "0.85rem",
                  }}
                >
                  no camera photos yet
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile layout ──────────────────────────── */}
      <div className="draws-mobile">
        <div
          style={{
            position: "relative",
            padding: "1.5rem 1rem 4rem",
            minHeight: "100vh",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              marginBottom: "1.5rem",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-headline)",
                fontSize: "0.8rem",
                color: PURPLE,
                letterSpacing: "0.12em",
              }}
            >
              with {mobileSide}
            </span>
            <UploadButton category={mobileSide} onUpload={handleUpload} />
          </div>

          {/* Content with side line */}
          <div
            style={{
              position: "relative",
              paddingLeft: mobileSide === "camera" ? "1.25rem" : 0,
              paddingRight: mobileSide === "pencil" ? "1.25rem" : 0,
            }}
          >
            {/* Vertical line */}
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                ...(mobileSide === "pencil" ? { right: 0 } : { left: 0 }),
                width: "1px",
                background: `linear-gradient(to bottom, ${PURPLE}, ${PURPLE}40, transparent)`,
                boxShadow: `0 0 8px ${PURPLE}30`,
              }}
            />

            {/* Side switcher on the line */}
            <button
              onClick={() =>
                setMobileSide((s) => (s === "pencil" ? "camera" : "pencil"))
              }
              style={{
                position: "absolute",
                top: "2rem",
                ...(mobileSide === "pencil"
                  ? { right: "-0.6rem" }
                  : { left: "-0.6rem" }),
                width: "1.2rem",
                height: "1.2rem",
                borderRadius: "50%",
                background: "#0e0e0e",
                border: `1.5px solid ${PURPLE}`,
                color: PURPLE,
                fontSize: "0.6rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 5,
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = PURPLE;
                e.currentTarget.style.color = "#0e0e0e";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#0e0e0e";
                e.currentTarget.style.color = PURPLE;
              }}
            >
              {mobileSide === "pencil" ? "›" : "‹"}
            </button>

            {/* Images */}
            {(mobileSide === "pencil" ? pencil : camera).length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                }}
              >
                {(mobileSide === "pencil" ? pencil : camera).map((d) => {
                  const globalIdx = drawings.findIndex((ad) => ad.id === d.id);
                  return (
                    <div
                      key={d.id}
                      onClick={() => setLightboxIdx(globalIdx)}
                      style={{
                        cursor: "pointer",
                        borderRadius: "4px",
                        overflow: "hidden",
                      }}
                    >
                      <img
                        src={`${API}${d.image}`}
                        alt={d.caption || `Drawing ${d.id}`}
                        loading="lazy"
                        style={{
                          width: "100%",
                          display: "block",
                          borderRadius: "4px",
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <p
                style={{
                  color: "#555",
                  fontStyle: "italic",
                  fontSize: "0.85rem",
                  textAlign: "center",
                  marginTop: "2rem",
                }}
              >
                no{" "}
                {mobileSide === "pencil" ? "pencil drawings" : "camera photos"}{" "}
                yet
              </p>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .draws-desktop { display: block; }
        .draws-mobile { display: none; }
        @media (max-width: 767px) {
          .draws-desktop { display: none; }
          .draws-mobile { display: block; }
        }
        .draws-hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .draws-hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </>
  );
}
