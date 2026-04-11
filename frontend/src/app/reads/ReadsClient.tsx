"use client";

import { CyberGrid, HexDecorations } from "@/components/CyberGrid";

/* ── TODO: AI Explorer ─────────────────────────────────
 *
 * Interactive feature: visitors can ask questions about anything Nam has read.
 *
 * Backend:
 *   - New Django endpoint: POST /api/reads/ask/
 *   - Ingest PDFs/essays into vector store (pgvector or Pinecone)
 *   - On query: embed question → retrieve relevant chunks → Claude API for answer
 *   - Rate-limit public queries (e.g. 10/hour per IP)
 *
 * Frontend:
 *   - Chat-like input at bottom of reads page (or expandable panel)
 *   - Stream response with typing indicator
 *   - Show source citations (which book/essay + page/section)
 *   - Cyberpunk-styled terminal/chat UI matching the page theme
 *
 * Data pipeline:
 *   - Admin uploads PDF → backend extracts text → chunk + embed → store
 *   - Or: pre-process offline, store embeddings in DB
 *   - Need to handle: PRML (700+ pages), Blanchard textbook, Vietnamese text (Phùng Quán)
 *
 * Open questions:
 *   - Public or admin-only?
 *   - Cost control (Claude API calls per visitor)
 *   - Cache common questions?
 * ──────────────────────────────────────────────────── */

/* ── Data ──────────────────────────────────────────── */

interface ReadItem {
  title: string;
  author: string;
  type: "book" | "paper" | "essay" | "audio book";
  description: string;
  tags: string[];
  url: string;
}

const READS: ReadItem[] = [
  {
    title: "Pattern Recognition and Machine Learning",
    author: "Christopher Bishop",
    type: "book",
    description:
      "The definitive textbook on probabilistic machine learning. Dense but rewarding.",
    tags: ["machine learning", "statistics", "bayesian"],
    url: "https://www.microsoft.com/en-us/research/wp-content/uploads/2006/01/Bishop-Pattern-Recognition-and-Machine-Learning-2006.pdf",
  },
  {
    title: "Tuổi Thơ Dữ Dội",
    author: "Phùng Quán",
    type: "book",
    description:
      "A raw, devastating account of child soldiers in the Vietnamese resistance.",
    tags: ["vietnamese literature", "war", "memoir"],
    url: "https://thuviensach.vn/img/pdf/13586-tuoi-tho-du-doi-thuviensach.vn.pdf",
  },
  {
    title: "Macroeconomics",
    author: "Olivier Blanchard",
    type: "book",
    description:
      "Clear and systematic introduction to macroeconomic theory and policy.",
    tags: ["economics", "macro", "textbook"],
    url: "https://home.ufam.edu.br/andersonlfc/MacroI/Livro%20Macro.pdf",
  },
  {
    title: "Nexus",
    author: "Yuval Noah Harari",
    type: "book",
    description:
      "How information networks have shaped human civilization from stone age to AI.",
    tags: ["history", "technology", "ai"],
    url: "https://cdn.penguin.co.uk/dam-assets/books/9781529933611/9781529933611-sample.pdf",
  },
  {
    title: "The Adolescence of Technology",
    author: "Dario Amodei",
    type: "essay",
    description:
      "Anthropic CEO's vision of AI's trajectory and what comes next.",
    tags: ["ai", "future", "technology"],
    url: "https://www.darioamodei.com/essay/the-adolescence-of-technology",
  },
];

const ONGOING_READS: ReadItem[] = [
  {
    title: "The History of China",
    author: "Chris Stewart",
    type: "audio book",
    description:
      "A sweeping podcast journey through Chinese history from ancient dynasties to the modern era.",
    tags: ["history", "china", "podcast"],
    url: "https://www.airwavemedia.com/our-shows/the-history-of-china",
  },
];

const FUTURE_READS: ReadItem[] = [
  {
    title: "AI Engineering",
    author: "Chip Huyen",
    type: "book",
    description:
      "Building applications with foundation models. Covers evaluation, RAG, agents, dataset engineering, and finetuning.",
    tags: ["AI", "engineering", "LLMs"],
    url: "https://github.com/chiphuyen/aie-book",
  },
];

const ACCENT = "#94a3b8";

const TYPE_LABEL: Record<string, string> = {
  book: "BOOK",
  paper: "PAPER",
  essay: "ESSAY",
  "audio book": "AUDIO BOOK",
};

/* ── Read card ──────────────────────────────────── */

function ReadCard({ item, dimmed }: { item: ReadItem; dimmed?: boolean }) {
  const linkLabel =
    item.type === "essay"
      ? "READ ESSAY"
      : item.type === "audio book"
        ? "LISTEN"
        : "READ PDF";
  return (
    <div
      className="read-card"
      style={{
        background: dimmed ? "#0f0f0f" : "#131313",
        border: `1px solid color-mix(in srgb, ${ACCENT} ${dimmed ? "12%" : "25%"}, #1a1a1a)`,
        borderLeft: `3px solid ${dimmed ? `color-mix(in srgb, ${ACCENT} 40%, #1a1a1a)` : ACCENT}`,
        borderRadius: "0.5rem",
        padding: "1.5rem",
        position: "relative",
        overflow: "hidden",
        opacity: dimmed ? 0.6 : 1,
      }}
    >
      {/* Corner bracket — top right */}
      <div
        style={{
          position: "absolute",
          top: -1,
          right: -1,
          width: "14px",
          height: "14px",
          borderTop: `2px solid ${ACCENT}`,
          borderRight: `2px solid ${ACCENT}`,
          opacity: dimmed ? 0.4 : 1,
        }}
      />

      {/* Header: type badge + title */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "0.5rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-headline)",
            fontSize: "0.6rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: ACCENT,
            border: `1px solid ${ACCENT}`,
            padding: "0.15rem 0.4rem",
            flexShrink: 0,
            boxShadow: dimmed
              ? "none"
              : `0 0 8px color-mix(in srgb, ${ACCENT} 30%, transparent)`,
          }}
        >
          {TYPE_LABEL[item.type] ?? item.type}
        </span>
      </div>

      {/* Title */}
      <h3
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "1.15rem",
          fontWeight: 700,
          color: "#e5e2e1",
          letterSpacing: "-0.01em",
          marginBottom: "0.25rem",
        }}
      >
        {item.title}
      </h3>

      {/* Author */}
      <p
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "0.8rem",
          color: "#888",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          marginBottom: "0.75rem",
        }}
      >
        {item.author}
      </p>

      {/* Separator */}
      <div
        style={{
          height: "1px",
          background: `linear-gradient(to right, ${ACCENT}30, transparent)`,
          marginBottom: "0.75rem",
        }}
      />

      {/* Description */}
      <p
        style={{
          fontSize: "0.85rem",
          lineHeight: 1.7,
          color: "#aaa",
          fontWeight: 300,
          marginBottom: "0.75rem",
        }}
      >
        {item.description}
      </p>

      {/* Tags */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          marginBottom: "1rem",
        }}
      >
        {item.tags.map((tag) => (
          <span
            key={tag}
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.6rem",
              color: ACCENT,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              padding: "0.15rem 0.5rem",
              border: `1px solid color-mix(in srgb, ${ACCENT} 30%, transparent)`,
              borderRadius: "2px",
              background: `color-mix(in srgb, ${ACCENT} 5%, transparent)`,
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Link */}
      <div
        style={{
          borderTop: `1px solid color-mix(in srgb, ${ACCENT} 10%, #1a1a1a)`,
          paddingTop: "0.75rem",
        }}
      >
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="read-link"
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.7rem",
              color: ACCENT,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            {linkLabel}
            <span style={{ fontSize: "0.85rem" }}>&#8599;</span>
          </a>
        ) : (
          <span
            style={{
              fontFamily: "var(--font-headline)",
              fontSize: "0.7rem",
              color: "#444",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            IN QUEUE
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Section header ─────────────────────────────── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        marginBottom: "1.5rem",
        position: "relative",
        zIndex: 2,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-headline)",
          fontSize: "0.7rem",
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: ACCENT,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: "1px",
          background: `linear-gradient(to right, ${ACCENT}40, transparent)`,
        }}
      />
    </div>
  );
}

/* ── Main component ──────────────────────────────── */

export default function ReadsClient() {
  return (
    <>
      <style>{`
        .read-card {
          animation: fadeUp 0.6s ease-out both;
          transition: border-color 0.3s, box-shadow 0.3s, opacity 0.3s;
        }
        .read-card:nth-child(2) { animation-delay: 0.1s; }
        .read-card:nth-child(3) { animation-delay: 0.2s; }
        .read-card:nth-child(4) { animation-delay: 0.3s; }
        .read-card:nth-child(5) { animation-delay: 0.4s; }
        .read-card:nth-child(6) { animation-delay: 0.5s; }
        .read-card:hover {
          border-color: color-mix(in srgb, ${ACCENT} 50%, #1a1a1a) !important;
          box-shadow: 0 0 24px color-mix(in srgb, ${ACCENT} 15%, transparent);
          opacity: 1 !important;
        }
        .read-link {
          transition: color 0.2s, text-shadow 0.2s;
        }
        .read-link:hover {
          text-shadow: 0 0 8px color-mix(in srgb, ${ACCENT} 50%, transparent);
        }
      `}</style>

      <div
        style={{
          maxWidth: "56rem",
          margin: "0 auto",
          padding: "2rem 1.5rem 6rem",
          position: "relative",
          minHeight: "100vh",
          overflow: "hidden",
        }}
      >
        <CyberGrid accent={ACCENT} prefix="reads" />
        <HexDecorations accent={ACCENT} />

        {/* Tagline */}
        <div
          style={{
            textAlign: "center",
            marginBottom: "3rem",
            position: "relative",
            zIndex: 2,
          }}
        >
          <p
            style={{
              fontStyle: "italic",
              color: "#666",
              fontSize: "0.9rem",
              letterSpacing: "0.04em",
            }}
          >
            i know many words
          </p>
        </div>

        {/* ── Read section ──────────────────────────── */}
        <SectionHeader label="// Read" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
            gap: "1.5rem",
            position: "relative",
            zIndex: 2,
            marginBottom: "4rem",
          }}
        >
          {READS.map((item) => (
            <ReadCard key={item.title} item={item} />
          ))}
        </div>

        {/* ── Ongoing section ────────────────────────── */}
        <SectionHeader label="// Ongoing" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
            gap: "1.5rem",
            position: "relative",
            zIndex: 2,
            marginBottom: "4rem",
          }}
        >
          {ONGOING_READS.map((item) => (
            <ReadCard key={item.title} item={item} />
          ))}
        </div>

        {/* ── Future Reads section ──────────────────── */}
        <SectionHeader label="// Queue" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
            gap: "1.5rem",
            position: "relative",
            zIndex: 2,
            marginBottom: "4rem",
          }}
        >
          {FUTURE_READS.map((item) => (
            <ReadCard key={item.title} item={item} dimmed />
          ))}
        </div>
      </div>
    </>
  );
}
