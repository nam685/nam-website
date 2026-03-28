import type { Metadata } from "next";

export const metadata: Metadata = { title: "Uses" };

export default function UsesPage() {
  return (
    <div className="page">
      <h1>Uses</h1>
      <p>Hardware, software, and tools I use daily.</p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Hardware</h2>
        <ul style={{ paddingLeft: "1.25rem", color: "#4b5563" }}>
          <li>Android phone (primary dev device via Termux)</li>
          <li>Laptop</li>
          <li>Hetzner Cloud ARM64 server</li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Dev Tools</h2>
        <ul style={{ paddingLeft: "1.25rem", color: "#4b5563" }}>
          <li>Termux + SSH + Mosh</li>
          <li>Zellij (terminal multiplexer)</li>
          <li>VS Code (remote)</li>
          <li>Claude Code (AI assistant)</li>
          <li>Git + GitHub</li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Stack</h2>
        <ul style={{ paddingLeft: "1.25rem", color: "#4b5563" }}>
          <li>Next.js + React + TypeScript</li>
          <li>Django + Python</li>
          <li>PostgreSQL + Redis</li>
          <li>Caddy (reverse proxy)</li>
          <li>Docker Compose</li>
        </ul>
      </section>
    </div>
  );
}
