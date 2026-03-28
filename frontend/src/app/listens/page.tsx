import type { Metadata } from "next";

export const metadata: Metadata = { title: "listens" };

export default function ListensPage() {
  return (
    <div className="page-narrow">
      <h1>Listens</h1>
      <p>
        Music, podcasts, and audio things. YouTube Music integration coming.
      </p>
    </div>
  );
}
