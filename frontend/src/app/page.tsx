import Link from "next/link";

export default function Home() {
  return (
    <div className="page">
      <div style={{ marginTop: "3rem", marginBottom: "2rem" }}>
        <h1>Hi, I&apos;m Nam</h1>
        <p style={{ fontSize: "1.1rem", maxWidth: "32rem" }}>
          I build things, draw pictures, and write about whatever catches my
          attention.
        </p>
      </div>

      <div className="card-grid">
        <Link href="/blog">
          <div className="card">
            <div className="card-body">
              <h3>Blog</h3>
              <p>Thoughts, diary entries, and random text</p>
            </div>
          </div>
        </Link>
        <Link href="/gallery">
          <div className="card">
            <div className="card-body">
              <h3>Gallery</h3>
              <p>Drawings, photos of cats, fish, trees, and more</p>
            </div>
          </div>
        </Link>
        <Link href="/projects">
          <div className="card">
            <div className="card-body">
              <h3>Projects</h3>
              <p>Demos and experiments from GitHub</p>
            </div>
          </div>
        </Link>
        <Link href="/cv">
          <div className="card">
            <div className="card-body">
              <h3>CV</h3>
              <p>Professional experience and skills</p>
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
}
