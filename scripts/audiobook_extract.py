"""Extract a PDF book to a clean, chunked, Haiku-cleaned manifest.json.

Usage:
    uv run python scripts/audiobook_extract.py <slug> <pdf-url-or-path> --title "..." --author "..."

Output: audiobooks/<slug>/{source.pdf,raw.txt,raw_outline.json,manifest.json}
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import fitz  # PyMuPDF
import httpx

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / "audiobooks"


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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("source", help="PDF URL or local path")
    args = ap.parse_args()

    out_dir = BOOKS_DIR / args.slug
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / "source.pdf"
    download_pdf(args.source, pdf_path)
    raw_text, outline = extract_text_and_outline(pdf_path, out_dir)
    print(f"[ok] extracted {len(raw_text):,} chars; {len(outline)} outline entries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
