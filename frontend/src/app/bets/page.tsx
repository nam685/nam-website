import type { Metadata } from "next";

export const metadata: Metadata = { title: "Bets" };

export default function BetsPage() {
  return (
    <div className="page-narrow">
      <h1>Bets</h1>
      <p>Financial portfolio, positions, and market commentary.</p>
    </div>
  );
}
