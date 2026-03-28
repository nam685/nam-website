import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reads" };

export default function ReadsPage() {
  return (
    <div className="page-narrow">
      <h1>Reads</h1>
      <p>News briefings, blog posts, and articles worth sharing.</p>
    </div>
  );
}
