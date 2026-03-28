import type { Metadata } from "next";

export const metadata: Metadata = { title: "plays" };

export default function PlaysPage() {
  return (
    <div className="page-narrow">
      <h1>Plays</h1>
      <p>Video games, chess, and other competitive things.</p>
    </div>
  );
}
