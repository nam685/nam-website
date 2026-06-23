"use client";

import { aoe2IconUrl } from "@/lib/aoe2Icons";

/**
 * Render the real AoE2 DE icon for a tech/unit/building/age NAME (bundled under /aoe2-icons/,
 * same-origin / CSP-safe). Best-effort: names without a bundled icon fall back to a clean
 * monogram glyph (first letter on a muted chip) so every row still reads cleanly.
 */
export default function Aoe2Icon({
  name,
  size = 16,
  color = "#888",
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const url = aoe2IconUrl(name);
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        title={name}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          borderRadius: 2,
          flexShrink: 0,
          imageRendering: "auto",
        }}
      />
    );
  }
  // Glyph fallback — first alpha char on a muted chip.
  const letter = (name.match(/[A-Za-z]/)?.[0] ?? "?").toUpperCase();
  return (
    <span
      title={name}
      aria-label={name}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.6,
        lineHeight: 1,
        fontFamily: "var(--font-headline, sans-serif)",
        color,
        background: "#161b22",
        border: "1px solid #232a33",
        borderRadius: 2,
      }}
    >
      {letter}
    </span>
  );
}
