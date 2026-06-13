"""Assemble a manifest.json from per-piece segment JSON files produced by subagents.

Reads:
    audiobooks/<slug>/work_items.json       — list of pieces in order
    audiobooks/<slug>/segments/<piece>.json — segments for each piece

Writes:
    audiobooks/<slug>/manifest.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / "audiobooks"
sys.path.insert(0, str(REPO_ROOT))
from scripts.audiobook_lib import chunk_paragraphs  # noqa: E402

VALID_KINDS = {
    "prose",
    "paraphrased_code",
    "code_bridge",
    "figure_bridge",
    "table_bridge",
    "equation_bridge",
}


def assemble(slug: str, title: str, author: str, voice: str, pdf_url: str) -> dict:
    book_dir = BOOKS_DIR / slug
    work_items = json.loads((book_dir / "work_items.json").read_text(encoding="utf-8"))
    segments_dir = book_dir / "segments"

    manifest_chapters: list[dict] = []
    manifest_chunks: list[dict] = []
    chunk_id = 0

    # Map chap_id -> chapter label by reading work_items
    chap_seen: set[str] = set()
    pieces_by_chap: dict[str, list[dict]] = {}
    for w in work_items:
        pieces_by_chap.setdefault(w["chap_id"], []).append(w)

    # Process in stable chap order (sorted by id which encodes the index)
    for chap_id in sorted(pieces_by_chap.keys()):
        pieces = sorted(pieces_by_chap[chap_id], key=lambda p: p["piece_idx"])
        chap_label = pieces[0]["chap_label"]

        chapter_chunk_start = chunk_id
        for piece in pieces:
            seg_path = segments_dir / f"{piece['piece_id']}.json"
            if not seg_path.exists():
                print(f"[warn] missing segment file: {seg_path}", file=sys.stderr)
                continue
            try:
                segments = json.loads(seg_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as e:
                print(f"[error] bad JSON in {seg_path}: {e}", file=sys.stderr)
                continue
            if not isinstance(segments, list):
                print(f"[warn] {seg_path} is not a JSON array", file=sys.stderr)
                continue
            for seg in segments:
                if not isinstance(seg, dict):
                    continue
                text = (seg.get("text") or "").strip()
                if not text:
                    continue
                kind = seg.get("kind", "prose")
                if kind not in VALID_KINDS:
                    kind = "prose"
                # Re-chunk long segments to keep individual chunks ≤1500 chars,
                # otherwise pass through.
                for piece_text in chunk_paragraphs(text, target_len=600, max_len=1500):
                    chunk: dict = {
                        "id": chunk_id,
                        "text": piece_text,
                        "duration_s": None,
                        "kind": kind,
                    }
                    if "page" in seg and isinstance(seg["page"], int):
                        chunk["page"] = seg["page"]
                    if "original" in seg and isinstance(seg["original"], str):
                        chunk["original"] = seg["original"][:500]
                    manifest_chunks.append(chunk)
                    chunk_id += 1

        if chap_id not in chap_seen:
            chap_seen.add(chap_id)
            manifest_chapters.append(
                {
                    "id": chap_id,
                    "label": chap_label,
                    "chunk_start": chapter_chunk_start,
                }
            )

    return {
        "slug": slug,
        "title": title,
        "author": author,
        "source_pdf_url": pdf_url,
        "voice": voice,
        "preprocessor": {
            "model": "claude-via-subagent-dispatch",
            "version": "2026-06-06",
        },
        "chapters": manifest_chapters,
        "chunks": manifest_chunks,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--title", required=True)
    ap.add_argument("--author", required=True)
    ap.add_argument("--voice", default="Charon")
    ap.add_argument("--pdf-url", default="")
    args = ap.parse_args()

    manifest = assemble(args.slug, args.title, args.author, args.voice, args.pdf_url)
    out = BOOKS_DIR / args.slug / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[ok] wrote {out} — {len(manifest['chapters'])} chapters, {len(manifest['chunks'])} chunks")

    # Quick sanity report
    kind_counts: dict[str, int] = {}
    for c in manifest["chunks"]:
        kind_counts[c["kind"]] = kind_counts.get(c["kind"], 0) + 1
    print("  kinds:", ", ".join(f"{k}={v}" for k, v in sorted(kind_counts.items())))
    total_chars = sum(len(c["text"]) for c in manifest["chunks"])
    print(f"  total text: {total_chars:,} chars")

    # Self-validate against the backend's _validate_manifest rules
    from website.views.audiobook import _validate_manifest

    err = _validate_manifest(manifest, args.slug)
    if err:
        print(f"[FAIL] manifest validation: {err}", file=sys.stderr)
        # Set duration_s to a placeholder so we can validate structure (TTS step fills real values)
        return 1
    print("[ok] manifest passes backend schema (duration_s=null still permitted? checking ...)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
