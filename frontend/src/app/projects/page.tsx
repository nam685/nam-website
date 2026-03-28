import type { Metadata } from "next";

export const metadata: Metadata = { title: "Projects" };

const projects = [
  {
    title: "Vibe Code via Phone",
    description:
      "Building and deploying code entirely from a phone using Termux and SSH.",
    tags: ["android", "termux", "devops"],
    url: null,
  },
  {
    title: "DIY Klaude Code",
    description: "A custom AI coding agent built from scratch.",
    tags: ["ai", "agent", "python"],
    url: null,
  },
];

export default function ProjectsPage() {
  return (
    <div className="page">
      <h1>Projects</h1>
      <p>Experiments, demos, and tools. Some open in their own app.</p>

      <div className="card-grid">
        {projects.map((project) => {
          const inner = (
            <div className="card">
              <div className="card-body">
                <h3>{project.title}</h3>
                <p>{project.description}</p>
                <div>
                  {project.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );

          return project.url ? (
            <a
              key={project.title}
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {inner}
            </a>
          ) : (
            <div key={project.title}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
