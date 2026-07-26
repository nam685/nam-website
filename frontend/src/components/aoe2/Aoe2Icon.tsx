"use client";

import { aoe2IconUrl } from "@/lib/aoe2Icons";

/**
 * Render the real AoE2 DE icon for a tech/unit/building/age NAME (bundled under /aoe2-icons/,
 * same-origin / CSP-safe). Every name in aoe2coach const.py resolves to a bundled icon; a name
 * that doesn't is a genuinely-unknown string (e.g. a brand-new unit not yet in const.py) and falls
 * back to a "?" chip — anticipating future content rather than showing a broken image or a bare dot.
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
  // Unknown name → "?" chip (anticipates future units/techs not yet in const.py).
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
        fontSize: size * 0.62,
        fontWeight: 700,
        lineHeight: 1,
        fontFamily: "var(--font-headline, sans-serif)",
        color,
        background: "#161b22",
        border: "1px solid #232a33",
        borderRadius: 2,
      }}
    >
      ?
    </span>
  );
}
