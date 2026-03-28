import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "codes" };

interface ExtraLink {
  label: string;
  url: string;
}

interface Project {
  title: string;
  slug: string;
  description: string;
  tags: string[];
  github_url: string;
  live_url: string;
  extra_links: ExtraLink[];
  status: "active" | "wip" | "archived";
}

async function getProjects(): Promise<Project[]> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/projects/`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return fallback;
    return res.json();
  } catch {
    return fallback;
  }
}

// Shown when API is unreachable (e.g. build time without backend)
const fallback: Project[] = [
  {
    title: "Vibe Code via Phone",
    slug: "vibe-code-phone",
    description:
      "Building and deploying code entirely from a phone using Termux and SSH.",
    tags: ["android", "termux", "devops"],
    github_url: "",
    live_url: "",
    extra_links: [],
    status: "wip",
  },
  {
    title: "DIY Klaude Code",
    slug: "klaude",
    description: "A custom AI coding agent built from scratch.",
    tags: ["ai", "agent", "python"],
    github_url: "",
    live_url: "",
    extra_links: [],
    status: "wip",
  },
];

const STATUS_LABEL: Record<string, string> = {
  active: "LIVE",
  wip: "WIP",
  archived: "ARCHIVED",
};

export default async function ProjectsPage() {
  const projects = await getProjects();

  return (
    <div className="page">
      <h1>Vibecodes</h1>
      <p>Experiments, demos, and tools. Some open in their own subdomain.</p>

      <div className="card-grid">
        {projects.map((project) => (
          <div key={project.slug} className="card">
            <div
              className="card-body"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <h3>{project.title}</h3>
                <span
                  style={{
                    fontSize: "0.65rem",
                    fontFamily: "var(--font-headline)",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    color:
                      project.status === "active" ? "var(--accent)" : "#555",
                    border: `1px solid ${project.status === "active" ? "var(--accent)" : "#333"}`,
                    padding: "0.1rem 0.35rem",
                    flexShrink: 0,
                    marginLeft: "0.5rem",
                  }}
                >
                  {STATUS_LABEL[project.status] ?? project.status}
                </span>
              </div>

              <p>{project.description}</p>

              <div>
                {project.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
              </div>

              {(project.github_url ||
                project.live_url ||
                project.extra_links.length > 0) && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    marginTop: "0.25rem",
                  }}
                >
                  {project.github_url && (
                    <a
                      href={project.github_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "0.75rem",
                        fontFamily: "var(--font-headline)",
                        color: "var(--accent)",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      ↗ GitHub
                    </a>
                  )}
                  {project.live_url && (
                    <a
                      href={project.live_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: "0.75rem",
                        fontFamily: "var(--font-headline)",
                        color: "var(--accent)",
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      ↗ Live
                    </a>
                  )}
                  {project.extra_links.map((link) =>
                    link.url.startsWith("/") ? (
                      <Link
                        key={link.url}
                        href={link.url}
                        style={{
                          fontSize: "0.75rem",
                          fontFamily: "var(--font-headline)",
                          color: "#666",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        → {link.label}
                      </Link>
                    ) : (
                      <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: "0.75rem",
                          fontFamily: "var(--font-headline)",
                          color: "#666",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        → {link.label}
                      </a>
                    ),
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
