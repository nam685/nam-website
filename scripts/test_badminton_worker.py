from pathlib import Path

import pytest

from scripts.badminton_worker import (
    JobFailedError,
    asset_paths,
    coach_job_params,
    content_type_for,
    find_submission,
    process_next,
    resolve_config,
    run_job,
)

SUBMISSION = {
    "id": "2026-09-17-a",
    "videos": [{"timeline": "assets/s/video-1-timeline.png"}],
    "attempts": [
        {"number": 1, "annotated_clip": "assets/s/attempt-01/annotated.mp4", "key_moments": None},
        {"number": 2, "annotated_clip": "assets/s/attempt-02/annotated.mp4", "notes": ["assets are fine"]},
    ],
}
REPORT = {"handedness": "right", "height_m": 1.71, "submissions": [{"id": "old", "attempts": []}, SUBMISSION]}
JOB = {
    "id": 7,
    "player": "nam",
    "height_m": 1.71,
    "hand": None,
    "lang": "vi",
    "filename": "clip.MOV",
    "size_bytes": 5,
    "video_url": "/media/badminton/raw/k/video.mov",
}


def test_asset_paths_walks_everything():
    assert asset_paths(SUBMISSION) == [
        "assets/s/attempt-01/annotated.mp4",
        "assets/s/attempt-02/annotated.mp4",
        "assets/s/video-1-timeline.png",
    ]


def test_find_submission():
    assert find_submission(REPORT, "2026-09-17-a") is SUBMISSION
    assert find_submission(REPORT, "nope") is None
    assert find_submission({}, None) is None


def test_coach_job_params():
    assert coach_job_params(JOB) == {"player": "nam", "lang": "vi", "height": "1.71"}
    assert coach_job_params({**JOB, "height_m": None, "hand": "left", "lang": ""}) == {
        "player": "nam",
        "lang": "en",
        "hand": "left",
    }


def test_content_type_for():
    assert content_type_for("a.MOV") == "video/quicktime"
    assert content_type_for("a.webm") == "video/webm"


def test_resolve_config():
    cfg = resolve_config(
        {"BADMINTON_SERVER_URL": "https://x.de/"},
        {"BADMINTON_ADMIN_SECRET": "s", "BADMINTON_COACH_TOKEN": "t"},
    )
    assert cfg["BADMINTON_SERVER_URL"] == "https://x.de"
    assert cfg["BADMINTON_COACH_URL"] == "http://127.0.0.1:8766"
    with pytest.raises(RuntimeError, match="BADMINTON_COACH_TOKEN"):
        resolve_config({"BADMINTON_SERVER_URL": "u", "BADMINTON_ADMIN_SECRET": "s"}, {})


class FakeSite:
    def __init__(self, jobs=()):
        self.jobs = list(jobs)
        self.calls = []
        self.assets = {}

    def claim(self):
        return self.jobs.pop(0) if self.jobs else None

    def progress(self, sub_id, step, stage):
        self.calls.append(("progress", sub_id, step, stage))

    def fail(self, sub_id, error):
        self.calls.append(("fail", sub_id, error))

    def download(self, _url, dest):
        Path(dest).write_bytes(b"video")

    def upload_asset(self, _sub_id, rel, local):
        self.assets[rel] = Path(local).read_bytes()

    def finish(self, sub_id, submission, handedness, height_m):
        self.calls.append(("finish", sub_id, submission["id"], handedness, height_m))


class FakeCoach:
    def __init__(self, states, report=REPORT):
        self.states = list(states)
        self.report = report
        self.submitted = None

    def submit(self, video, filename, params):
        self.submitted = (Path(video).read_bytes(), filename, params)
        return self.states.pop(0)

    def job(self, _job_id):
        return self.states.pop(0)

    def get_json(self, path):
        assert path == "/api/players/nam/report.json"
        return self.report

    def download(self, path, dest):
        Path(dest).write_bytes(path.encode())


def _states(final):
    return [
        {"id": "j", "status": "queued", "step": None, "stage": None},
        {"id": "j", "status": "running", "step": "analyzing", "stage": "measure_racket"},
        final,
    ]


DONE = {"id": "j", "status": "done", "submission_id": "2026-09-17-a", "report": "/api/players/nam/report.json"}


def test_run_job_happy_path(tmp_path):
    site, coach = FakeSite(), FakeCoach(_states(DONE))
    run_job(site, coach, JOB, tmp_path, sleep_fn=lambda _s: None)
    assert coach.submitted == (b"video", "clip.MOV", {"player": "nam", "lang": "vi", "height": "1.71"})
    assert ("progress", 7, "analyzing", "measure_racket") in site.calls
    assert site.assets["assets/s/attempt-02/annotated.mp4"] == b"/api/players/nam/assets/s/attempt-02/annotated.mp4"
    assert len(site.assets) == 3
    assert site.calls[-1] == ("finish", 7, "2026-09-17-a", "right", 1.71)


def test_run_job_coach_failure(tmp_path):
    site, coach = FakeSite(), FakeCoach(_states({"id": "j", "status": "failed", "error": "no attempts found"}))
    with pytest.raises(JobFailedError, match="no attempts found"):
        run_job(site, coach, JOB, tmp_path, sleep_fn=lambda _s: None)


def test_run_job_missing_submission(tmp_path):
    site, coach = FakeSite(), FakeCoach(_states({**DONE, "submission_id": "gone"}))
    with pytest.raises(JobFailedError, match="not found"):
        run_job(site, coach, JOB, tmp_path, sleep_fn=lambda _s: None)


def test_process_next_reports_failure_and_continues(monkeypatch):
    import scripts.badminton_worker as worker

    monkeypatch.setattr(worker, "run_job", lambda *_a, **_k: (_ for _ in ()).throw(JobFailedError("boom")))
    site = FakeSite([JOB])
    assert process_next(site, FakeCoach([])) is True
    assert site.calls == [("fail", 7, "boom")]
    assert process_next(site, FakeCoach([])) is False
