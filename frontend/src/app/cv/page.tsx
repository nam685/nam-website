import type { Metadata } from "next";

export const metadata: Metadata = { title: "CV" };

export default function CVPage() {
  return (
    <div className="page">
      <h1>CV</h1>
      <p>Professional experience and skills.</p>

      <section style={{ marginTop: "2rem" }}>
        <h2>About</h2>
        <p>
          Software engineer based in Bremen, Germany. Interested in full-stack
          development, AI, and building useful tools.
        </p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Skills</h2>
        <div>
          {[
            "Python",
            "Django",
            "TypeScript",
            "React",
            "Next.js",
            "PostgreSQL",
            "Docker",
            "Linux",
            "Git",
          ].map((skill) => (
            <span key={skill} className="tag">
              {skill}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Experience</h2>
        <p style={{ color: "#9ca3af", fontStyle: "italic" }}>Coming soon.</p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Education</h2>
        <p style={{ color: "#9ca3af", fontStyle: "italic" }}>Coming soon.</p>
      </section>
    </div>
  );
}
