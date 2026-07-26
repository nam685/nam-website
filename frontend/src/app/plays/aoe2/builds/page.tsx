import type { Metadata } from "next";
import Link from "next/link";
import { fetchAoe2Builds } from "@/lib/api";
import { groupBuildsByFamily } from "@/lib/aoe2";

export const metadata: Metadata = {
  title: "AoE2 build orders",
  description:
    "A reference library of Age of Empires II build orders — scouts, archers, men-at-arms, drush, knights, fast castle and trash — adapted from Hera's strategy guide.",
};

const ACCENT = "var(--accent)";

export default async function BuildLibraryPage() {
  const builds = await fetchAoe2Builds();
  const groups = groupBuildsByFamily(builds);

  return (
    <div
      className="page"
      style={{ maxWidth: "72rem", position: "relative", zIndex: 1 }}
    >
      <div style={{ marginTop: "1.25rem", marginBottom: "1.75rem" }}>
        <div
          style={{
            fontSize: "0.6rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#666",
            marginBottom: "0.4rem",
          }}
        >
          <Link href="/plays" style={{ color: "#888" }}>
            plays
          </Link>{" "}
          / AoE2 / build orders
        </div>
        <h1
          style={{
            fontSize: "1.6rem",
            color: "#eee",
            fontFamily: "var(--font-headline, sans-serif)",
            margin: 0,
          }}
        >
          Build-Order Library
        </h1>
        <p
          style={{
            fontSize: "0.85rem",
            color: "#999",
            maxWidth: "46rem",
            marginTop: "0.5rem",
            lineHeight: 1.5,
          }}
        >
          Eleven reference build orders adapted from Hera&apos;s strategy guide,
          grouped by family. Each one breaks down the villager split, age
          timings and step-by-step plan — pick a build and learn it.
        </p>
      </div>

      {builds.length === 0 ? (
        <p style={{ fontSize: "0.85rem", color: "#666", fontStyle: "italic" }}>
          Build library is unavailable right now.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.family} style={{ marginBottom: "2rem" }}>
            <div
              style={{
                fontSize: "0.7rem",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: ACCENT,
                marginBottom: "0.75rem",
                borderBottom: "1px solid #1a1a1a",
                paddingBottom: "0.35rem",
              }}
            >
              {group.label}
            </div>
            <div
              style={{
                display: "grid",
                gap: "0.75rem",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(min(100%, 19rem), 1fr))",
              }}
            >
              {group.builds.map((b) => (
                <Link
                  key={b.id}
                  href={`/plays/aoe2/builds/${b.id}`}
                  style={{
                    display: "block",
                    padding: "0.9rem 1rem",
                    background: "rgba(13,17,23,0.72)",
                    border: "1px solid #1c2330",
                    borderRadius: 4,
                    textDecoration: "none",
                    transition: "border-color 0.15s",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.95rem",
                        color: "#eee",
                        fontWeight: 600,
                      }}
                    >
                      {b.name}
                    </span>
                    <span style={{ fontSize: "0.55rem", color: ACCENT }}>
                      {group.label}
                    </span>
                  </div>
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color: "#999",
                      lineHeight: 1.45,
                      marginTop: "0.4rem",
                      marginBottom: 0,
                    }}
                  >
                    {b.summary}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
