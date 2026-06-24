"""AoE2 DE recorded-game watcher. Run on the gaming PC; uploads new 1v1 recs to the site.

Config via env vars, or a ``scripts/aoe2_watcher.env`` file (KEY=VALUE lines) next to
this script when the env vars are not set. Env vars win over the file.
  AOE2_SERVER_URL   e.g. https://nam685.de
  AOE2_ADMIN_SECRET the site ADMIN_SECRET (local machine only)
  AOE2_REC_DIR      e.g. C:\\Users\\lehai\\Games\\Age of Empires 2 DE\\<steamid>\\savegame

Event-driven: polls the folder every few seconds, uploads each .aoe2record once it stops
growing (write complete at match end). On startup it scans the existing folder (backlog
catch-up). Keeps a local set of uploaded hashes so it never re-posts; the server also
dedups by hash, so restarts re-upload nothing.

Eager preprocess, lazy coach: every upload is sent with coach=0 so the server runs the
deterministic analysis immediately (the match shows up right away) but does NOT run the
LLM coach inline. The coach is dripped later by the server's coach_backlog cron, which
respects the Claude Max session budget. Without this, the startup backlog catch-up would
fire hundreds of inline coach runs and blow the rate limit.

Runs unattended (see scripts/install_aoe2_watcher.ps1): a top-level supervisor restarts
the watch loop after any error, so a network blip or expired login never kills the daemon.
Output goes to a size-rotated aoe2_watcher.log next to this script as well as stdout.
"""

import glob
import hashlib
import logging
import os
import time
from logging.handlers import RotatingFileHandler

import httpx

POLL_SECONDS = 5
RETRY_DELAY_SECONDS = 30
REQUIRED_KEYS = ("AOE2_SERVER_URL", "AOE2_ADMIN_SECRET", "AOE2_REC_DIR")

log = logging.getLogger("aoe2_watcher")


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


def load_env_file(path):
    """Parse a simple KEY=VALUE file. Missing file -> {}. Blank/comment/no-'=' lines skipped."""
    values = {}
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        values[key.strip()] = val.strip()
    return values


def resolve_config(environ, file_values):
    """Merge config: env vars win over file values. Raise RuntimeError listing any missing keys."""
    cfg = {}
    missing = []
    for key in REQUIRED_KEYS:
        val = environ.get(key) or file_values.get(key)
        if not val:
            missing.append(key)
        else:
            cfg[key] = val
    if missing:
        raise RuntimeError(f"missing required config: {', '.join(missing)} (set env vars or aoe2_watcher.env)")
    cfg["AOE2_SERVER_URL"] = cfg["AOE2_SERVER_URL"].rstrip("/")
    return cfg


def supervise(target, sleep_fn=time.sleep, retry_delay=RETRY_DELAY_SECONDS, iterations=None):
    """Run target() forever; on any exception, log it, sleep, and retry. Never propagates.

    iterations bounds the loop (tests only); None means run forever.
    """
    n = 0
    while iterations is None or n < iterations:
        n += 1
        try:
            target()
        except Exception as exc:  # noqa: BLE001 — daemon must survive anything
            log.error("watch loop crashed: %s; retrying in %ss", exc, retry_delay)
            sleep_fn(retry_delay)


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
            data={"coach": "0"},  # eager deterministic preprocess; coach drips via server cron
            timeout=120,
        )
    return resp


def watch_loop(server, secret, rec_dir, poll_seconds=POLL_SECONDS):
    """Poll rec_dir forever, uploading each stable new rec once. Raises on fatal errors
    (e.g. login failure) so the supervisor can restart it."""
    token = _login(server, secret)
    seen = set()
    sizes = {}
    log.info("watching %s", rec_dir)

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
                    log.info("uploaded %s -> %s", os.path.basename(path), resp.json())
                else:
                    log.warning("upload failed %s: %s", resp.status_code, os.path.basename(path))
            except Exception as exc:  # noqa: BLE001 — one bad file must not crash the loop
                log.error("error %s: %s", os.path.basename(path), exc)
        time.sleep(poll_seconds)


def setup_logging(log_path):
    handlers = [logging.StreamHandler()]
    try:
        handlers.append(RotatingFileHandler(log_path, maxBytes=1_000_000, backupCount=3, encoding="utf-8"))
    except OSError:
        pass  # unwritable dir -> stdout only
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
    )


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    setup_logging(os.path.join(here, "aoe2_watcher.log"))
    cfg = resolve_config(os.environ, load_env_file(os.path.join(here, "aoe2_watcher.env")))
    supervise(lambda: watch_loop(cfg["AOE2_SERVER_URL"], cfg["AOE2_ADMIN_SECRET"], cfg["AOE2_REC_DIR"]))


if __name__ == "__main__":
    main()
