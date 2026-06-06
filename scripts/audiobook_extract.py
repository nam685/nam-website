"""Extract a PDF book to a clean, chunked, Haiku-cleaned manifest.json.

Usage:
    uv run python scripts/audiobook_extract.py <slug> <pdf-url-or-path> --title "..." --author "..."

Output: audiobooks/<slug>/{source.pdf,raw.txt,raw_outline.json,manifest.json}
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import textwrap
from pathlib import Path

import fitz  # PyMuPDF
import httpx
from anthropic import Anthropic

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / "audiobooks"
sys.path.insert(0, str(REPO_ROOT))
from scripts.audiobook_lib import chunk_paragraphs, clean_pdf_text  # noqa: E402

HAIKU_MODEL = "claude-haiku-4-5"
DEFAULT_VOICE = "Charon"

SYSTEM_PROMPT = textwrap.dedent("""
    You are converting a book passage to a TTS-friendly script.

    Input is raw text extracted from a PDF — may contain broken lines, code blocks,
    figures, equations, and tables.

    Output a JSON array of segments. Each segment has:
      - text: the spoken text (plain prose, fully expanded — no abbreviations like "e.g." → "for example")
      - kind: one of "prose", "paraphrased_code", "code_bridge",
              "figure_bridge", "table_bridge", "equation_bridge"
      - page: integer page number if known, otherwise omit
      - original: only for paraphrased_code or code_bridge — the original code as a string

    Rules:
      1. Keep prose intact, fix line breaks, rejoin hyphenated words.
      2. SHORT code snippets (one-line SQL, simple expressions): paraphrase in one sentence.
         kind = "paraphrased_code", set "original" to the raw code.
      3. LONG code listings (multi-line, structural): one bridge sentence pointing to the PDF page.
         kind = "code_bridge", original = the raw listing (truncated to 500 chars).
      4. Tables, figures, equations: one bridge sentence each.
         kind = "table_bridge" / "figure_bridge" / "equation_bridge".
      5. Drop captions, headers, footers, page numbers, decorative text.
      6. Output ONLY valid JSON — no markdown fences, no commentary.
""").strip()


def download_pdf(source: str, target: Path) -> None:
    if target.exists():
        print(f"[skip] {target} already exists")
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.startswith(("http://", "https://")):
        print(f"[fetch] downloading {source}")
        with httpx.stream("GET", source, follow_redirects=True, timeout=120) as r:
            r.raise_for_status()
            with open(target, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=8192):
                    f.write(chunk)
    else:
        src_path = Path(source)
        if not src_path.exists():
            sys.exit(f"PDF not found: {source}")
        target.write_bytes(src_path.read_bytes())
    print(f"[ok] saved {target} ({target.stat().st_size:,} bytes)")


def extract_text_and_outline(pdf_path: Path, out_dir: Path) -> tuple[str, list]:
    """Return (raw_text, outline). Writes raw.txt and raw_outline.json."""
    doc = fitz.open(pdf_path)
    pages_text: list[str] = []
    for page in doc:
        pages_text.append(page.get_text("text"))
    raw_text = "\n\n".join(pages_text)
    (out_dir / "raw.txt").write_text(raw_text)
    outline = [{"level": level, "title": title, "page": page} for (level, title, page) in doc.get_toc()]
    (out_dir / "raw_outline.json").write_text(json.dumps(outline, indent=2, ensure_ascii=False))
    doc.close()
    return raw_text, outline


def _chapter_ranges(outline: list, raw_text: str) -> list[tuple[str, str, str]]:
    """Split raw text by top-level outline entries.

    Returns list of (chapter_id, chapter_label, chapter_text).
    Fallback: if no outline (or none of the titles match), returns one entry covering the whole text.
    """
    top = [e for e in outline if e.get("level", 1) == 1]
    if not top:
        return [("body", "Body", raw_text)]
    boundaries: list[int] = []
    matched_top: list[dict] = []
    for entry in top:
        idx = raw_text.find(entry["title"])
        if idx >= 0:
            boundaries.append(idx)
            matched_top.append(entry)
    if not matched_top:
        return [("body", "Body", raw_text)]
    # Pair the matched titles with their positions
    paired = sorted(zip(boundaries, matched_top, strict=True), key=lambda p: p[0])
    ranges: list[tuple[str, str, str]] = []
    for i, (start, entry) in enumerate(paired):
        end = paired[i + 1][0] if i + 1 < len(paired) else len(raw_text)
        slug = "".join(c for c in entry["title"].lower() if c.isalnum())[:24]
        chap_id = f"ch{i:02d}_{slug}" if slug else f"ch{i:02d}"
        ranges.append((chap_id, entry["title"], raw_text[start:end]))
    return ranges


def _cache_path(out_dir: Path, chapter_id: str, payload: str) -> Path:
    h = hashlib.sha256(payload.encode()).hexdigest()[:12]
    cache_dir = out_dir / ".cache"
    cache_dir.mkdir(exist_ok=True)
    return cache_dir / f"{chapter_id}_{h}.json"


def haiku_clean_chapter(
    client: Anthropic,
    chapter_id: str,
    chapter_text: str,
    out_dir: Path,
) -> list[dict]:
    """Send a chapter to Haiku, return list of segment dicts. Cached."""
    cleaned_input = clean_pdf_text(chapter_text)
    cache = _cache_path(out_dir, chapter_id, cleaned_input)
    if cache.exists():
        return json.loads(cache.read_text())

    max_call = 50_000
    pieces = [cleaned_input[i : i + max_call] for i in range(0, len(cleaned_input), max_call)]
    all_segments: list[dict] = []
    for i, piece in enumerate(pieces):
        print(f"  [haiku] {chapter_id} piece {i + 1}/{len(pieces)} ({len(piece)} chars)")
        try:
            msg = client.messages.create(
                model=HAIKU_MODEL,
                max_tokens=8192,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": piece}],
            )
            raw = "".join(block.text for block in msg.content if block.type == "text")
            segments = json.loads(raw)
            if isinstance(segments, list):
                all_segments.extend(segments)
        except (json.JSONDecodeError, Exception) as e:
            print(f"  [warn] piece failed ({e}); falling back to plain prose")
            all_segments.append({"text": piece, "kind": "prose"})
    cache.write_text(json.dumps(all_segments, indent=2, ensure_ascii=False))
    return all_segments


def build_manifest(
    slug: str,
    title: str,
    author: str,
    voice: str,
    pdf_url: str,
    out_dir: Path,
    raw_text: str,
    outline: list,
) -> dict:
    client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    chapter_ranges = _chapter_ranges(outline, raw_text)

    manifest_chapters: list[dict] = []
    manifest_chunks: list[dict] = []
    chunk_id = 0
    for chap_id, chap_label, chap_text in chapter_ranges:
        manifest_chapters.append({"id": chap_id, "label": chap_label, "chunk_start": chunk_id})
        segments = haiku_clean_chapter(client, chap_id, chap_text, out_dir)
        for seg in segments:
            seg_text = (seg.get("text") or "").strip()
            if not seg_text:
                continue
            seg_kind = seg.get("kind", "prose")
            for piece in chunk_paragraphs(seg_text):
                chunk: dict = {
                    "id": chunk_id,
                    "text": piece,
                    "duration_s": None,
                    "kind": seg_kind,
                }
                if "page" in seg:
                    chunk["page"] = seg["page"]
                if "original" in seg:
                    chunk["original"] = seg["original"][:500]
                manifest_chunks.append(chunk)
                chunk_id += 1

    return {
        "slug": slug,
        "title": title,
        "author": author,
        "source_pdf_url": pdf_url,
        "voice": voice,
        "preprocessor": {"model": HAIKU_MODEL, "version": "2026-06-06"},
        "chapters": manifest_chapters,
        "chunks": manifest_chunks,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("source", help="PDF URL or local path")
    ap.add_argument("--title", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--voice", default=DEFAULT_VOICE)
    args = ap.parse_args()

    out_dir = BOOKS_DIR / args.slug
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / "source.pdf"
    download_pdf(args.source, pdf_path)
    raw_text, outline = extract_text_and_outline(pdf_path, out_dir)
    print(f"[ok] extracted {len(raw_text):,} chars; {len(outline)} outline entries")

    manifest = build_manifest(
        slug=args.slug,
        title=args.title,
        author=args.author,
        voice=args.voice,
        pdf_url=args.source if args.source.startswith("http") else "",
        out_dir=out_dir,
        raw_text=raw_text,
        outline=outline,
    )
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"[ok] wrote manifest.json — {len(manifest['chunks'])} chunks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
