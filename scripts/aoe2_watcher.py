"""AoE2 DE recorded-game watcher. Run on the gaming PC; uploads new 1v1 recs to the site.

Config via env:
  AOE2_SERVER_URL   e.g. https://nam685.de
  AOE2_ADMIN_SECRET the site ADMIN_SECRET (local machine only)
  AOE2_REC_DIR      e.g. C:\\Users\\lehai\\Games\\Age of Empires 2 DE\\<steamid>\\savegame

Event-driven: polls the folder every few seconds, uploads each .aoe2record once it stops
growing (write complete at match end). On startup it scans the existing folder (backlog
catch-up). Keeps a local set of uploaded hashes so it never re-posts.
"""

import glob
import hashlib
import os
import sys
import time

import httpx

POLL_SECONDS = 5


def hash_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def already_uploaded(file_hash, seen):
    return file_hash in seen


def is_stable(path, prev_size):
    return os.path.getsize(path) == prev_size


def find_recs(rec_dir):
    return sorted(glob.glob(os.path.join(rec_dir, "*.aoe2record")))


def _login(server, secret):
    resp = httpx.post(f"{server}/api/auth/login/", json={"secret": secret}, timeout=30)
    resp.raise_for_status()
    return resp.json()["token"]


def _upload(server, token, path):
    with open(path, "rb") as f:
        resp = httpx.post(
            f"{server}/api/aoe2/upload/",
            headers={"Authorization": f"Bearer {token}"},
            files={"rec": (os.path.basename(path), f, "application/octet-stream")},
            timeout=120,
        )
    return resp


def main():
    server = os.environ["AOE2_SERVER_URL"].rstrip("/")
    secret = os.environ["AOE2_ADMIN_SECRET"]
    rec_dir = os.environ["AOE2_REC_DIR"]

    token = _login(server, secret)
    seen = set()
    sizes = {}
    print(f"watching {rec_dir}", flush=True)

    while True:
        for path in find_recs(rec_dir):
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            prev = sizes.get(path)
            sizes[path] = size
            if prev is None or not is_stable(path, prev):
                continue  # wait for the next tick to confirm the file stopped growing
            file_hash = hash_file(path)
            if already_uploaded(file_hash, seen):
                continue
            try:
                resp = _upload(server, token, path)
                if resp.status_code == 401:  # token expired -> re-login once
                    token = _login(server, secret)
                    resp = _upload(server, token, path)
                if resp.status_code in (200, 201):
                    seen.add(file_hash)
                    print(f"uploaded {os.path.basename(path)} -> {resp.json()}", flush=True)
                else:
                    print(f"upload failed {resp.status_code}: {os.path.basename(path)}", file=sys.stderr, flush=True)
            except Exception as exc:  # noqa: BLE001
                print(f"error {os.path.basename(path)}: {exc}", file=sys.stderr, flush=True)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
