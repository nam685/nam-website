import type { Metadata } from "next";

import { API_INTERNAL } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Todo" };

type Item = { text: string; done: boolean };
type Section = { title: string; items: Item[] };

async function getTodo(): Promise<Section[]> {
  const res = await fetch(`${API_INTERNAL}/api/todo/`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error("Failed to fetch todo");
  return res.json();
}

function countDone(items: Item[]) {
  return items.filter((i) => i.done).length;
}

export default async function TodoPage() {
  const sections = await getTodo();
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
