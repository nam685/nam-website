import type { Metadata } from "next";

export const metadata: Metadata = { title: "Watches" };

export default function WatchesPage() {
  return (
    <div className="page-narrow">
      <h1>Watches</h1>
      <p>YouTube videos, channels, and visual content worth following.</p>
    </div>
  );
}
