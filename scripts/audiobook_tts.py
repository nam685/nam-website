"""Generate MP3s for each chunk in audiobooks/<slug>/manifest.json,
then upload them to the VPS, then publish the manifest.

Usage:
    GEMINI_API_KEY=... NAM_ADMIN_TOKEN=... NAM_BASE_URL=https://nam685.de \
        uv run python scripts/audiobook_tts.py <slug>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from google import genai
from google.genai import types
from mutagen.mp3 import MP3

REPO_ROOT = Path(__file__).resolve().parent.parent
BOOKS_DIR = REPO_ROOT / "audiobooks"

GEMINI_MODEL = "gemini-2.5-flash-preview-tts"

# ~5s of silent MP3 frame; not perfect but harmless as a fallback
SILENCE_MP3 = b"\xff\xfb\x90d\x00" + b"\x00" * 6000


def tts_one_chunk(client: genai.Client, voice: str, text: str, target: Path) -> None:
    """Generate one MP3, retrying transient failures."""
    for attempt in range(3):
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(
                        voice_config=types.VoiceConfig(
                            prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                voice_name=voice,
                            ),
                        ),
                    ),
                ),
            )
            audio_bytes = response.candidates[0].content.parts[0].inline_data.data
            tmp = target.with_suffix(".mp3.tmp")
            tmp.write_bytes(audio_bytes)
            tmp.rename(target)
            return
        except Exception as e:
            print(f"  [warn] TTS attempt {attempt + 1} failed: {e}")
            time.sleep(2**attempt)
    print("  [error] TTS gave up for chunk → writing silence placeholder")
    target.write_bytes(SILENCE_MP3)


def measure_duration(path: Path) -> float:
    try:
        return float(MP3(path).info.length)
    except Exception:
        return 0.0


def upload_chunk(
    http: httpx.Client,
    base_url: str,
    slug: str,
    chunk_id: int,
    mp3_path: Path,
    admin_token: str,
) -> None:
    head = http.get(
        f"{base_url}/api/audiobooks/{slug}/exists/{chunk_id}/",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    if head.status_code == 200:
        return
    with open(mp3_path, "rb") as f:
        files = {"mp3": (f"{chunk_id:05d}.mp3", f, "audio/mpeg")}
        data = {"chunk_id": str(chunk_id)}
        r = http.post(
            f"{base_url}/api/audiobooks/{slug}/upload-chunk/",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=120,
        )
        r.raise_for_status()


def publish_manifest(http: httpx.Client, base_url: str, slug: str, manifest: dict, admin_token: str) -> None:
    r = http.post(
        f"{base_url}/api/audiobooks/{slug}/publish/",
        json=manifest,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=60,
    )
    if r.status_code != 200:
        sys.exit(f"publish failed: {r.status_code} {r.text}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    book_dir = BOOKS_DIR / args.slug
    manifest_path = book_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"missing {manifest_path} — run audiobook_extract.py first")
    manifest = json.loads(manifest_path.read_text())

    audio_dir = book_dir / "audio"
    audio_dir.mkdir(exist_ok=True)

    api_key = os.environ.get("GEMINI_API_KEY")
    admin_token = os.environ.get("NAM_ADMIN_TOKEN")
    base_url = os.environ.get("NAM_BASE_URL", "http://localhost:8000")
    if not api_key:
        sys.exit("GEMINI_API_KEY required")
    if not admin_token:
        sys.exit("NAM_ADMIN_TOKEN required")

    gemini = genai.Client(api_key=api_key)

    missing = [c for c in manifest["chunks"] if not (audio_dir / f"{c['id']:05d}.mp3").exists()]
    print(f"[tts] {len(missing)} chunks to generate (out of {len(manifest['chunks'])})")
    for chunk in missing:
        target = audio_dir / f"{chunk['id']:05d}.mp3"
        print(f"  [{chunk['id']}/{len(manifest['chunks'])}] {chunk['text'][:60]!r}")
        tts_one_chunk(gemini, manifest["voice"], chunk["text"], target)

    for chunk in manifest["chunks"]:
        if chunk.get("duration_s") is None:
            chunk["duration_s"] = round(measure_duration(audio_dir / f"{chunk['id']:05d}.mp3"), 2)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print("[ok] durations measured")

    print(f"[upload] uploading to {base_url}")
    with httpx.Client(timeout=120) as http:

        def upload_one(c):
            upload_chunk(http, base_url, args.slug, c["id"], audio_dir / f"{c['id']:05d}.mp3", admin_token)

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(upload_one, manifest["chunks"]))

        print("[publish] writing manifest on server")
        publish_manifest(http, base_url, args.slug, manifest, admin_token)
    print("[done]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
