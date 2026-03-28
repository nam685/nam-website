import type { Metadata } from "next";

export const metadata: Metadata = { title: "Changelog" };

const entries = [
  {
    date: "2026-03-21",
    changes: [
      "Site launched at nam685.de",
      "Two-tab image gallery with drawings",
      "Responsive design for mobile",
      "Caddy reverse proxy with auto HTTPS",
      "CI/CD with GitHub Actions",
      "Added /blog, /gallery, /projects, /cv pages",
      "Added /now, /uses, /changelog pages",
      "Pre-commit hooks (ruff, eslint, prettier)",
      "Health check endpoints",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="page">
      <h1>Changelog</h1>
      <p>What&apos;s new on this site.</p>

      <div className="post-list">
        {entries.map((entry) => (
          <article key={entry.date} className="post-item">
            <div className="post-date">{entry.date}</div>
            <ul style={{ paddingLeft: "1.25rem", color: "#4b5563" }}>
              {entry.changes.map((change, i) => (
                <li key={i}>{change}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
