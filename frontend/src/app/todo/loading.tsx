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

export default function TodoLoading() {
  return (
    <div className="page">
      <h1>Todo</h1>
      <p>What I want to build on this site.</p>

      {[1, 2, 3].map((i) => (
        <section key={i} style={{ marginTop: "2rem" }}>
          <Skeleton width="8rem" height="1.1rem" />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
              marginTop: "0.75rem",
            }}
          >
            <Skeleton width="80%" height="0.9rem" />
            <Skeleton width="65%" height="0.9rem" />
            <Skeleton width="70%" height="0.9rem" />
          </div>
        </section>
      ))}
    </div>
  );
}
