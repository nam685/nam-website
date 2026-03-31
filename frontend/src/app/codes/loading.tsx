const ACCENT = "#22c55e";

function Skeleton({ width, height }: { width: string; height: string }) {
  return (
    <div
      style={{
        width,
        height,
        background: "#1a1a1a",
        borderRadius: "0.25rem",
      }}
    />
  );
}

function CardSkeleton() {
  return (
    <div
      style={{
        background: "#131313",
        border: `1px solid color-mix(in srgb, ${ACCENT} 25%, #1a1a1a)`,
        borderLeft: `3px solid ${ACCENT}`,
        borderRadius: "0.5rem",
        padding: "1.5rem",
        flex: "1 1 340px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Skeleton width="50%" height="1.15rem" />
        <Skeleton width="3rem" height="1rem" />
      </div>
      <div
        style={{
          height: "1px",
          background: `linear-gradient(to right, ${ACCENT}30, transparent)`,
        }}
      />
      <Skeleton width="100%" height="2.5rem" />
      <div style={{ display: "flex", gap: "0.4rem" }}>
        <Skeleton width="4rem" height="1.2rem" />
        <Skeleton width="4rem" height="1.2rem" />
        <Skeleton width="4rem" height="1.2rem" />
      </div>
    </div>
  );
}

export default function CodesLoading() {
  return (
    <div
      style={{
        maxWidth: "56rem",
        margin: "0 auto",
        padding: "2rem 1.5rem 6rem",
        position: "relative",
      }}
    >
      {/* Tagline placeholder */}
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <Skeleton width="10rem" height="0.9rem" />
      </div>

      {/* Card skeletons */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem" }}>
        <CardSkeleton />
        <CardSkeleton />
      </div>

      {/* Contribution graph skeleton */}
      <div style={{ marginTop: "4rem" }}>
        <div
          style={{
            background: "#0d1117",
            border: `1px solid color-mix(in srgb, ${ACCENT} 15%, #1a1a1a)`,
            borderRadius: "0.5rem",
            padding: "1rem",
          }}
        >
          <Skeleton width="100%" height="6rem" />
        </div>
      </div>
    </div>
  );
}
