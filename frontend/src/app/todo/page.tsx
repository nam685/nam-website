import type { Metadata } from "next";

export const metadata: Metadata = { title: "Todo" };

type Item = { text: string; done: boolean };
type Section = { title: string; items: Item[] };

const sections: Section[] = [
  {
    title: "High Priority",
    items: [
      { text: "To-do list feature on the site itself", done: false },
      {
        text: "Rework UI/UX layout and styling (careful, intentional design)",
        done: false,
      },
      {
        text: "RPG/Terraria-style townhall map as main landing page — pixel art buildings representing each section",
        done: false,
      },
      { text: "Website favicon/logo for browser tab (cat head)", done: true },
      {
        text: "Internationalization with next-intl (Vietnamese, English, French, German)",
        done: false,
      },
    ],
  },
  {
    title: "Content",
    items: [
      { text: "Fill in CV (experience, education)", done: false },
      { text: "Write first real blog post", done: false },
      { text: "Upload more gallery images (cats, fish, trees)", done: false },
      {
        text: "Image upload feature — web UI to upload from phone browser",
        done: false,
      },
      {
        text: "Blog topics: geopolitics, finance, macro economics, history",
        done: false,
      },
      {
        text: "TIL (Today I Learned) section — short technical notes",
        done: false,
      },
      { text: "YouTube playlists page", done: false },
      { text: "Music page — favorite tracks/playlists", done: false },
      {
        text: "Food section — cookbook, recipes, recommendations, randomizer",
        done: false,
      },
    ],
  },
  {
    title: "Health & Fitness",
    items: [
      { text: "Run tracker — distance, routes shown on map", done: false },
      { text: "Gym log — pull-ups, exercises, progress tracking", done: false },
      { text: "Health diary — sickness, symptoms, history", done: false },
      {
        text: "AI health chatbot — ask agent about symptoms (with disclaimers)",
        done: false,
      },
    ],
  },
  {
    title: "News & Briefing",
    items: [
      {
        text: "AI news crawler agent — auto-fetch and summarize news",
        done: false,
      },
      {
        text: "Daily briefing page — Bloomberg-style (geopolitics, tech, finance, culture)",
        done: false,
      },
      {
        text: "Source aggregation — RSS feeds, news APIs, social media",
        done: false,
      },
      { text: "Custom feed — filter by topic, region, relevance", done: false },
    ],
  },
  {
    title: "Financial",
    items: [
      { text: "Portfolio tracker — stocks, ETFs, crypto", done: false },
      {
        text: "Bank data import — N26, Revolut, Trade Republic integration",
        done: false,
      },
      { text: "Spending analysis & visualization", done: false },
    ],
  },
  {
    title: "Minecraft",
    items: [
      {
        text: "Minecraft section — server link (play.thirdplace.net), screenshots of builds",
        done: false,
      },
      { text: "Build showcase gallery", done: false },
    ],
  },
  {
    title: "Projects",
    items: [
      {
        text: "Set up subdomain pattern for project demos (e.g. klaude.nam685.de)",
        done: false,
      },
      { text: "DIY Klaude Code demo", done: false },
      { text: "Vibe Code via Phone writeup", done: false },
      {
        text: "Ellamind product suite integration (TBD ~June 2026)",
        done: false,
      },
    ],
  },
  {
    title: "Design",
    items: [
      {
        text: "Discover Stitch (Figma killer) — explore for UI/UX design without being a pro designer",
        done: false,
      },
      { text: "Define color palette and design system", done: false },
      { text: "Typography choices", done: false },
      { text: "Consistent spacing/sizing tokens", done: false },
      { text: "Light/dark mode (auto, follows system preference)", done: true },
      { text: "Pixel art assets for RPG landing page", done: false },
    ],
  },
  {
    title: "Personal Pages",
    items: [
      { text: "/now — what I'm currently doing/reading/playing", done: true },
      { text: "/uses — hardware, software, tools, dotfiles", done: true },
      { text: "Digital garden — interconnected wiki-style notes", done: false },
      { text: "Reading list — books read, rating, notes", done: false },
      { text: "Bookmarks — saved links with tags", done: false },
      { text: "Changelog — public site changelog", done: true },
      { text: "RSS feed for blog (/feed.xml)", done: true },
    ],
  },
  {
    title: "Social",
    items: [
      { text: "Guestbook — visitors leave messages", done: false },
      { text: "Blogroll — links to sites/blogs I follow", done: false },
      { text: "Webring — link exchange with friends", done: false },
      { text: "Wishlist", done: false },
      {
        text: "Webmentions — decentralized comments from other sites",
        done: false,
      },
      { text: "ActivityPub / Fediverse integration", done: false },
      { text: "Email newsletter — subscribe form", done: false },
    ],
  },
  {
    title: "Admin / Auth",
    items: [
      {
        text: "Authentication system (login, session management)",
        done: false,
      },
      {
        text: "Admin dashboard — content management, image upload, post editor",
        done: false,
      },
      { text: "Role-based access (public vs private content)", done: false },
      { text: "Public/private content separation", done: false },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      { text: "Set up GitHub Actions deploy SSH key secret", done: false },
      { text: "Start PostgreSQL + Redis via Docker Compose", done: false },
      { text: "Deploy Django backend", done: false },
      {
        text: "Upgrade Node.js to 20+ (fixes Tailwind v4 ARM64 support)",
        done: false,
      },
      { text: "Dependabot for auto dependency updates", done: true },
      { text: "Uptime monitoring / health check cron", done: false },
    ],
  },
];

function countDone(items: Item[]) {
  return items.filter((i) => i.done).length;
}

export default function TodoPage() {
  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  const totalDone = sections.reduce((sum, s) => sum + countDone(s.items), 0);

  return (
    <div className="page">
      <h1>Todo</h1>
      <p>
        What I want to build on this site.{" "}
        <span style={{ color: "#9ca3af", fontSize: "0.9rem" }}>
          {totalDone}/{totalItems} done
        </span>
      </p>

      {sections.map((section) => {
        const done = countDone(section.items);
        return (
          <section key={section.title} style={{ marginTop: "2rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.5rem",
                marginBottom: "0.5rem",
              }}
            >
              <h2 style={{ margin: 0 }}>{section.title}</h2>
              <span style={{ color: "#9ca3af", fontSize: "0.85rem" }}>
                {done}/{section.items.length}
              </span>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {section.items.map((item, i) => (
                <li
                  key={i}
                  className="todo-item"
                  style={{
                    color: item.done ? "#9ca3af" : "inherit",
                    textDecoration: item.done ? "line-through" : "none",
                  }}
                >
                  <span
                    style={{
                      marginTop: "0.1rem",
                      flexShrink: 0,
                      fontSize: "0.85rem",
                      color: "#9ca3af",
                    }}
                  >
                    {item.done ? "✓" : "○"}
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
