"""Badminton swing-analysis worker. Run on the GPU PC next to `badminton-coach serve`.

Bridges nam685.de and the local badminton-coach job API (see badminton-coach's docs/website-handoff.md):
  1. polls the site for a submission the admin approved on /plays/badminton ("approve & run now"),
  2. downloads its video and posts it to `badminton-coach serve`,
  3. mirrors the job's progress back to the site,
  4. when done, uploads the finished submission from the player's report.json plus every asset it
     references, and marks the submission done (or failed, with the error, so the admin can retry).

Nothing runs unless the admin approved it, and the worker only ever talks to the local coach service and
the site. Jobs run one at a time.

Config via env vars, or a ``scripts/badminton_worker.env`` file (KEY=VALUE lines) next to this script:
  BADMINTON_SERVER_URL    e.g. https://nam685.de
  BADMINTON_ADMIN_SECRET  the site's ADMIN_SECRET
  BADMINTON_COACH_TOKEN   the token `badminton-coach serve` was started with ($BADMINTON_COACH_TOKEN)
  BADMINTON_COACH_URL     optional, default http://127.0.0.1:8766

Usage:
  uv run --with httpx python scripts/badminton_worker.py          # poll forever
  uv run --with httpx python scripts/badminton_worker.py --once   # drain approved jobs, then exit

A rejected login (wrong/stale secret) stops the worker instead of retrying — retries burn the site's per-IP
login rate limit and lock the admin out of /sudo.
"""

import argparse
import logging
import os
import tempfile
import time
from pathlib import Path, PurePosixPath

import httpx

POLL_SECONDS = 15
COACH_POLL_SECONDS = 10
HEARTBEAT_SECONDS = 60
REQUIRED_KEYS = ("BADMINTON_SERVER_URL", "BADMINTON_ADMIN_SECRET", "BADMINTON_COACH_TOKEN")
DEFAULT_COACH_URL = "http://127.0.0.1:8766"
CONTENT_TYPES = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
}

log = logging.getLogger("badminton_worker")


class FatalAuthError(Exception):
    """The site rejected our secret — retrying can't fix it and locks the admin out."""


class JobFailedError(Exception):
    """The analysis failed; the message is reported to the site."""


# ── pure helpers ───────────────────────────────────────────────────────────


def load_env_file(path):
    """Parse a simple KEY=VALUE file. Missing file -> {}. Blank/comment/no-'=' lines skipped."""
    values = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                values[key.strip()] = val.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return values


def resolve_config(environ, file_values):
    """Env vars win over file values. Raise RuntimeError listing missing keys."""
    cfg = {}
    missing = []
    for key in REQUIRED_KEYS:
        val = environ.get(key) or file_values.get(key)
        if val:
            cfg[key] = val
        else:
            missing.append(key)
    if missing:
        raise RuntimeError(f"missing required config: {', '.join(missing)} (set env vars or badminton_worker.env)")
    cfg["BADMINTON_SERVER_URL"] = cfg["BADMINTON_SERVER_URL"].rstrip("/")
    coach = environ.get("BADMINTON_COACH_URL") or file_values.get("BADMINTON_COACH_URL") or DEFAULT_COACH_URL
    cfg["BADMINTON_COACH_URL"] = coach.rstrip("/")
    return cfg


def asset_paths(value):
    """Every relative `assets/...` path referenced anywhere in a report.json fragment, sorted."""
    found = set()
    stack = [value]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            stack.extend(v.values())
        elif isinstance(v, list):
            stack.extend(v)
        elif isinstance(v, str) and v.startswith("assets/"):
            found.add(v)
    return sorted(found)


def find_submission(report, submission_id):
    """The submission with this id in the player's report.json, or None."""
    for sub in report.get("submissions") or []:
        if sub.get("id") == submission_id:
            return sub
    return None


def coach_job_params(job):
    """Query params for `POST /api/jobs` of badminton-coach serve, from a claimed site job."""
    params = {"player": job["player"], "lang": job.get("lang") or "en"}
    if job.get("height_m"):
        params["height"] = f"{float(job['height_m']):.2f}"
    if job.get("hand") in ("left", "right"):
        params["hand"] = job["hand"]
    return params


def content_type_for(filename):
    return CONTENT_TYPES.get(Path(filename).suffix.lower(), "video/mp4")


# ── site client ────────────────────────────────────────────────────────────


class Site:
    def __init__(self, server, secret, http=None):
        self.server = server
        self.secret = secret
        self.http = http or httpx.Client(timeout=120)
        self.token = None

    def login(self):
        resp = self.http.post(f"{self.server}/api/auth/login/", json={"secret": self.secret}, timeout=30)
        if resp.status_code in (401, 403):
            raise FatalAuthError(f"login rejected ({resp.status_code}) — BADMINTON_ADMIN_SECRET is wrong or stale")
        resp.raise_for_status()
        self.token = resp.json()["token"]

    def request(self, method, path, **kwargs):
        if self.token is None:
            self.login()
        for attempt in range(2):
            resp = self.http.request(
                method, f"{self.server}{path}", headers={"Authorization": f"Bearer {self.token}"}, **kwargs
            )
            if resp.status_code == 401 and attempt == 0:  # token expired (7-day TTL) → re-login once
                self.login()
                continue
            return resp
        return resp

    def claim(self):
        resp = self.request("POST", "/api/badminton/worker/claim/")
        if resp.status_code == 204:
            return None
        resp.raise_for_status()
        return resp.json()

    def progress(self, sub_id, step, stage):
        self.request("POST", f"/api/badminton/worker/{sub_id}/progress/", json={"step": step, "stage": stage})

    def fail(self, sub_id, error):
        self.request("POST", f"/api/badminton/worker/{sub_id}/fail/", json={"error": error})

    def upload_asset(self, sub_id, rel_path, local_path):
        with open(local_path, "rb") as f:
            resp = self.request(
                "POST",
                f"/api/badminton/worker/{sub_id}/asset/",
                data={"path": rel_path},
                files={"file": (PurePosixPath(rel_path).name, f, "application/octet-stream")},
                timeout=600,
            )
        resp.raise_for_status()

    def finish(self, sub_id, submission, handedness, height_m):
        resp = self.request(
            "POST",
            f"/api/badminton/worker/{sub_id}/finish/",
            json={"submission": submission, "handedness": handedness, "height_m": height_m},
        )
        if resp.status_code != 200:
            raise JobFailedError(f"site refused the report ({resp.status_code}): {resp.text[:500]}")

    def download(self, url, dest):
        with self.http.stream("GET", f"{self.server}{url}", timeout=httpx.Timeout(60, read=300)) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as out:
                for chunk in resp.iter_bytes(1024 * 1024):
                    out.write(chunk)


# ── coach client ───────────────────────────────────────────────────────────


class Coach:
    def __init__(self, url, token, http=None):
        self.url = url
        self.http = http or httpx.Client(timeout=60, headers={"Authorization": f"Bearer {token}"})

    def submit(self, video_path, filename, params):
        def body():
            with open(video_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk

        resp = self.http.post(
            f"{self.url}/api/jobs",
            params=params,
            content=body(),
            headers={
                "Content-Type": content_type_for(filename),
                "X-Filename": filename,
                "Content-Length": str(os.path.getsize(video_path)),
            },
            timeout=httpx.Timeout(60, write=600),
        )
        if resp.status_code != 202:
            raise JobFailedError(f"badminton-coach refused the video ({resp.status_code}): {_error_text(resp)}")
        return resp.json()

    def job(self, job_id):
        resp = self.http.get(f"{self.url}/api/jobs/{job_id}")
        resp.raise_for_status()
        return resp.json()

    def get_json(self, path):
        resp = self.http.get(f"{self.url}{path}")
        resp.raise_for_status()
        return resp.json()

    def download(self, path, dest):
        with self.http.stream("GET", f"{self.url}{path}") as resp:
            resp.raise_for_status()
            with open(dest, "wb") as out:
                for chunk in resp.iter_bytes(1024 * 1024):
                    out.write(chunk)


def _error_text(resp):
    try:
        return resp.json().get("error") or resp.text[:500]
    except ValueError:
        return resp.text[:500]


# ── the job ────────────────────────────────────────────────────────────────


def run_job(site, coach, job, workdir, sleep_fn=time.sleep):
    """Analyse one claimed submission end to end. Raises JobFailedError (or anything else) on failure."""
    sub_id = job["id"]
    video = Path(workdir) / f"video{Path(job['filename']).suffix.lower()}"
    log.info("#%s: downloading %s (%.0f MB)", sub_id, job["filename"], job["size_bytes"] / 1e6)
    site.progress(sub_id, "downloading", "")
    site.download(job["video_url"], video)

    site.progress(sub_id, "sending", "")
    cjob = coach.submit(video, job["filename"], coach_job_params(job))
    log.info("#%s: badminton-coach job %s", sub_id, cjob["id"])

    last, last_sent = None, 0.0
    while cjob["status"] in ("receiving", "queued", "running"):
        state = (cjob.get("step") or cjob["status"], cjob.get("stage") or "")
        if state != last or time.monotonic() - last_sent > HEARTBEAT_SECONDS:
            site.progress(sub_id, *state)
            if state != last:
                log.info("#%s: %s %s", sub_id, *state)
            last, last_sent = state, time.monotonic()
        sleep_fn(COACH_POLL_SECONDS)
        cjob = coach.job(cjob["id"])

    if cjob["status"] != "done":
        raise JobFailedError(cjob.get("error") or f"badminton-coach job ended as {cjob['status']}")

    site.progress(sub_id, "uploading", "")
    report = coach.get_json(cjob["report"])
    submission = find_submission(report, cjob.get("submission_id"))
    if submission is None:
        raise JobFailedError(f"submission {cjob.get('submission_id')!r} not found in {job['player']}'s report.json")

    base = cjob["report"].rsplit("/", 1)[0]  # /api/players/<id>
    paths = asset_paths(submission)
    for i, rel in enumerate(paths, 1):
        local = Path(workdir) / "asset"
        coach.download(f"{base}/{rel}", local)
        site.upload_asset(sub_id, rel, local)
        log.info("#%s: asset %d/%d %s", sub_id, i, len(paths), rel)

    site.finish(sub_id, submission, report.get("handedness"), report.get("height_m"))
    log.info("#%s: done — %d attempts", sub_id, len(submission.get("attempts") or []))


def process_next(site, coach):
    """Claim and run one job. Returns False when the queue is empty."""
    job = site.claim()
    if job is None:
        return False
    with tempfile.TemporaryDirectory(prefix="badminton-") as workdir:
        try:
            run_job(site, coach, job, workdir)
        except FatalAuthError:
            raise
        except Exception as exc:  # noqa: BLE001 — report every failure to the site, keep serving
            log.error("#%s failed: %s", job["id"], exc)
            try:
                site.fail(job["id"], str(exc) or exc.__class__.__name__)
            except Exception as report_exc:  # noqa: BLE001
                log.error("#%s: could not report the failure: %s", job["id"], report_exc)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--once", action="store_true", help="drain approved jobs, then exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    here = os.path.dirname(os.path.abspath(__file__))
    cfg = resolve_config(os.environ, load_env_file(os.path.join(here, "badminton_worker.env")))
    site = Site(cfg["BADMINTON_SERVER_URL"], cfg["BADMINTON_ADMIN_SECRET"])
    coach = Coach(cfg["BADMINTON_COACH_URL"], cfg["BADMINTON_COACH_TOKEN"])
    log.info("worker up: site %s, coach %s", cfg["BADMINTON_SERVER_URL"], cfg["BADMINTON_COACH_URL"])

    try:
        while True:
            try:
                worked = process_next(site, coach)
            except FatalAuthError:
                raise
            except httpx.HTTPError as exc:  # site/network blip — keep polling
                log.warning("poll failed: %s", exc)
                worked = False
            if not worked:
                if args.once:
                    return
                time.sleep(POLL_SECONDS)
    except FatalAuthError as exc:
        log.error("%s — stopping", exc)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
