import type { Metadata } from "next";

export const metadata: Metadata = { title: "Now" };

export default function NowPage() {
  return (
    <div className="page">
      <h1>Now</h1>
      <p>What I&apos;m up to right now. Last updated: 2026-03-21.</p>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Building</h2>
        <ul style={{ paddingLeft: "1.25rem", color: "#4b5563" }}>
          <li>This website — from my phone via Termux + SSH</li>
          <li>DIY Klaude Code — custom AI coding agent</li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Playing</h2>
        <ul style={{ paddingLeft: "1.25rem", color: "#4b5563" }}>
          <li>
            Minecraft on{" "}
            <a
              href="https://thirdplace.net"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "underline" }}
            >
              play.thirdplace.net
            </a>
          </li>
        </ul>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Reading</h2>
        <p style={{ color: "#9ca3af", fontStyle: "italic" }}>Coming soon.</p>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2>Listening</h2>
        <p style={{ color: "#9ca3af", fontStyle: "italic" }}>Coming soon.</p>
      </section>
    </div>
  );
}
