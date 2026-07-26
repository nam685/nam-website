import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import BuildTimeline from "@/components/aoe2/BuildTimeline";
import { fetchAoe2Build } from "@/lib/api";
import { buildFamilyLabel } from "@/lib/aoe2";

const ACCENT = "var(--accent)";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const build = await fetchAoe2Build(id);
  if (!build) return { title: "Build order" };
  return {
    title: `${build.name} — AoE2 build`,
    description: build.summary?.trim() || `${build.name} build order.`,
  };
}

const sectionLabel: React.CSSProperties = {
  fontSize: "0.7rem",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: ACCENT,
  marginBottom: "0.75rem",
  borderBottom: "1px solid #1a1a1a",
  paddingBottom: "0.35rem",
};

function fmtArrival(s: number | null | undefined): string {
  if (typeof s !== "number" || s <= 0) return "—";
  const sec = Math.floor(s);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export default async function BuildDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const build = await fetchAoe2Build(id);
  if (!build) notFound();

  const familyLabel = buildFamilyLabel(build.family);
  const civs = build.recommended_civs ?? [];
  const guide = build.source?.guide ?? "";
  const page = build.source?.page ?? null;

  const ageRows = [
    { label: "Feudal", t: build.age_targets?.feudal },
    { label: "Castle", t: build.age_targets?.castle },
    { label: "Imperial", t: build.age_targets?.imperial },
  ].filter((r) => r.t && (r.t.arrival_s != null || r.t.vils_at_click != null));

  return (
    <div
      className="page"
      style={{ maxWidth: "72rem", position: "relative", zIndex: 1 }}
    >
      {/* Breadcrumb */}
      <div
        style={{
          fontSize: "0.6rem",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#666",
          marginTop: "1.25rem",
          marginBottom: "0.5rem",
        }}
      >
        <Link href="/plays" style={{ color: "#888" }}>
          plays
        </Link>{" "}
        / AoE2 /{" "}
        <Link href="/plays/aoe2/builds" style={{ color: "#888" }}>
          build orders
        </Link>{" "}
        / {familyLabel}
      </div>

      {/* Header */}
      <header style={{ marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem" }}>
          <h1
            style={{
              fontSize: "1.6rem",
              color: "#eee",
              fontFamily: "var(--font-headline, sans-serif)",
              margin: 0,
            }}
          >
            {build.name}
          </h1>
          <span
            style={{
              fontSize: "0.6rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: ACCENT,
              border: `1px solid ${ACCENT}`,
              borderRadius: 3,
              padding: "0.1rem 0.4rem",
            }}
          >
            {familyLabel}
          </span>
        </div>
        <p
          style={{
            fontSize: "0.9rem",
            color: "#bbb",
            maxWidth: "48rem",
            lineHeight: 1.55,
            marginTop: "0.6rem",
          }}
        >
          {build.summary?.trim()}
        </p>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "1.5rem",
            marginTop: "0.9rem",
            fontSize: "0.72rem",
            color: "#999",
          }}
        >
          {civs.length > 0 && (
            <div>
              <span style={{ color: "#666" }}>Recommended civs: </span>
              <span style={{ color: "#ddd" }}>{civs.join(", ")}</span>
            </div>
          )}
          {guide && (
            <div>
              <span style={{ color: "#666" }}>Source: </span>
              <span style={{ color: "#ddd" }}>
                Hera strategy guide{page != null ? `, p. ${page}` : ""}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Phase-laned timeline graphic with the real icons */}
      <section style={{ marginBottom: "2rem" }}>
        <div style={sectionLabel}>Timeline</div>
        <BuildTimeline build={build} />
      </section>

      <div
        style={{
          display: "grid",
          gap: "2rem",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 22rem), 1fr))",
        }}
      >
        {/* Ordered step list */}
        <section>
          <div style={sectionLabel}>Steps</div>
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {build.steps.map((step, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  alignItems: "baseline",
                  fontSize: "0.8rem",
                }}
              >
                <span
                  style={{
                    color: ACCENT,
                    fontSize: "0.6rem",
                    minWidth: "1.2rem",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    fontSize: "0.55rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    color: "#666",
                    minWidth: "4.5rem",
                  }}
                >
                  {step.phase.replace("_", " ")}
                </span>
                <span style={{ color: "#ddd", lineHeight: 1.4 }}>
                  {step.vils != null && (
                    <span style={{ color: "#888" }}>{step.vils} vils — </span>
                  )}
                  {step.task}
                </span>
              </li>
            ))}
          </ol>

          {ageRows.length > 0 && (
            <div style={{ marginTop: "1.25rem" }}>
              <div style={sectionLabel}>Age targets</div>
              <div
                style={{
                  display: "flex",
                  gap: "1.5rem",
                  flexWrap: "wrap",
                  fontSize: "0.8rem",
                }}
              >
                {ageRows.map((r) => (
                  <div key={r.label}>
                    <div
                      style={{
                        fontSize: "0.55rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        color: "#666",
                      }}
                    >
                      {r.label}
                    </div>
                    <div style={{ color: "#ddd" }}>
                      {fmtArrival(r.t?.arrival_s)}
                    </div>
                    {r.t?.vils_at_click != null && (
                      <div style={{ fontSize: "0.58rem", color: "#777" }}>
                        {r.t.vils_at_click} vils on click
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* What's next */}
        <section>
          <div style={sectionLabel}>What&apos;s next</div>
          {build.whats_next?.length ? (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.55rem",
              }}
            >
              {build.whats_next.map((w, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: "0.8rem",
                    color: "#ccc",
                    lineHeight: 1.5,
                    paddingLeft: "0.85rem",
                    borderLeft: `2px solid ${ACCENT}`,
                  }}
                >
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            <p
              style={{
                fontSize: "0.78rem",
                color: "#666",
                fontStyle: "italic",
              }}
            >
              No follow-up transitions listed.
            </p>
          )}
        </section>
      </div>

      <div style={{ marginTop: "2.5rem" }}>
        <Link
          href="/plays/aoe2/builds"
          style={{ fontSize: "0.75rem", color: ACCENT }}
        >
          ← back to the build library
        </Link>
      </div>
    </div>
  );
}
