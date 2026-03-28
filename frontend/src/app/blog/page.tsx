import type { Metadata } from "next";

export const metadata: Metadata = { title: "Blog" };

const posts = [
  {
    slug: "hello-world",
    title: "Hello World",
    date: "2026-03-21",
    excerpt:
      "First post on the new site. Built with Next.js on a Hetzner ARM64 server, deployed from my phone.",
  },
];

export default function BlogPage() {
  return (
    <div className="page">
      <h1>Blog</h1>
      <p>Thoughts, diary entries, and random text.</p>

      <div className="post-list">
        {posts.map((post) => (
          <article key={post.slug} className="post-item">
            <div className="post-date">{post.date}</div>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
