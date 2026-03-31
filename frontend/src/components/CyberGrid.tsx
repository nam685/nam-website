/**
 * Shared cyberpunk background SVG grid + floating hex decorations.
 *
 * Used by /codes and /reads pages. Each instance needs a unique `prefix`
 * so the SVG pattern IDs don't collide when both are in the DOM.
 */

interface CyberGridProps {
  /** Accent color, e.g. "#22c55e" or "#94a3b8" */
  accent: string;
  /** Unique prefix for SVG pattern IDs, e.g. "codes" or "reads" */
  prefix: string;
}

export function CyberGrid({ accent, prefix }: CyberGridProps) {
  const gridId = `${prefix}-grid`;
  const diagId = `${prefix}-diag`;

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        opacity: 0.06,
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id={gridId} width="60" height="60" patternUnits="userSpaceOnUse">
          <path
            d="M 60 0 L 0 0 0 60"
            fill="none"
            stroke={accent}
            strokeWidth="0.5"
          />
        </pattern>
        <pattern
          id={diagId}
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M-10,10 l20,-20 M0,40 l40,-40 M30,50 l20,-20"
            stroke={accent}
            strokeWidth="0.3"
            fill="none"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${gridId})`} />
      <rect width="100%" height="100%" fill={`url(#${diagId})`} />
      <circle cx="15%" cy="20%" r="3" fill="none" stroke={accent} strokeWidth="0.5" />
      <circle cx="85%" cy="35%" r="2" fill={accent} opacity="0.4" />
      <circle cx="10%" cy="60%" r="2" fill={accent} opacity="0.3" />
      <circle cx="90%" cy="75%" r="3" fill="none" stroke={accent} strokeWidth="0.5" />
      <line x1="12%" y1="20%" x2="18%" y2="20%" stroke={accent} strokeWidth="0.5" />
      <line x1="82%" y1="35%" x2="88%" y2="35%" stroke={accent} strokeWidth="0.5" />
    </svg>
  );
}

/** Default hex decoration positions used by both /codes and /reads. */
const DEFAULT_HEX_POSITIONS = [
  { top: "6%", left: "4%", size: 28, delay: 0 },
  { top: "20%", left: "90%", size: 20, delay: 1.2 },
  { top: "50%", left: "2%", size: 22, delay: 0.6 },
  { top: "65%", left: "93%", size: 18, delay: 1.8 },
];

interface HexDecorationsProps {
  accent: string;
}

export function HexDecorations({ accent }: HexDecorationsProps) {
  return (
    <>
      {DEFAULT_HEX_POSITIONS.map((h, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: h.top,
            left: h.left,
            width: `${h.size}px`,
            height: `${h.size}px`,
            border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`,
            transform: "rotate(45deg)",
            animation: `hexFloat 6s ${h.delay}s ease-in-out infinite`,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}
