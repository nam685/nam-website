# Slops file download — design

**Date:** 2026-04-19
**Status:** approved
**Related:** [upload design](./2026-04-19-slops-file-upload-design.md) (symmetric inverse)

## Goal

Let Klaude share files with the user by writing them to a conventional
`downloads/<session_id>/<turn_id>/` directory inside the klaude workspace. After
a turn completes, the backend registers each file as a `Download` row and the
frontend renders clickable chips under the assistant's answer. Clicking a chip
streams the file as an attachment.

## Non-goals

- Changes to the klaude CLI. The contract is pure prompt-prefix convention;
  klaude only needs its existing file-writing tools.
- Inline previews (image thumbnails, PDF rendering, syntax-highlighted text).
  Files are offered as opaque byte streams.
- MIME sniffing, extension allowlists, or virus scanning of klaude outputs.
  Admin approval is the primary safety gate, same as uploads.
- Generic file hosting. Downloads are tied to a single turn and deleted with
  the session.
- Streaming files larger than `MAX_SINGLE_FILE`. Oversize files are visible
  but not servable.

## User flow

1. User submits a prompt on `/slops`.
2. `_execute_klaude` prepends a **downloads-prefix** telling klaude the exact
   relative path it can write to and the size caps.
3. Klaude may (or may not) write files into that directory during the turn.
4. Turn completes with `status=done`. Backend scans the directory, enforces
   caps, creates one `Download` row per file.
5. Trace UI renders download chips below the assistant message:
   `report.md · 12.3 KB · ⬇`. Clicking hits a streaming endpoint.
6. Oversize files show as `notes.log · 9.1 MB · (too large)` with no link, so
   the user knows the file existed but is not offered it.

## Limits (v1)

Single source of truth: constants in `website/views/slops.py`, mirrored in
`frontend/src/lib/slopsLimits.ts`. These are the same constants introduced by
the upload design; this design reuses them rather than adding new ones.

- `MAX_FILES_PER_TURN = 5`
- `MAX_SINGLE_FILE = 5 * 1024 * 1024` (5 MB) — files over this size are
  registered with `oversize=True` and not servable
- `MAX_TOTAL_UPLOAD = 10 * 1024 * 1024` (10 MB per turn) — applies to
  **servable** bytes only; oversize files count as 0. Once the running total
  of servable bytes would exceed this, further files are skipped entirely
  (no row).

If upload lands first these names are inherited verbatim. If download lands
first we introduce them under the same names so upload can pick them up.

## Storage layout

Files live inside the klaude workspace so klaude can reference them with
relative paths.

```
/home/klaude/workspace/klaude-playground/
  downloads/
    <session_id>/
      <turn_id>/
        <filename>
        <filename>
```

- Owned by the `klaude` user. Django reads via `sudo -u klaude cat` / `find`.
- Directory created on demand by klaude (it uses `write_file` / `bash mkdir`);
  Django never creates it. If the directory does not exist after the turn,
  the turn simply has no downloads.
- Relative path klaude sees (cwd is the workspace):
  `downloads/<session_id>/<turn_id>/<filename>`.

## Data model

New model `website/models/download.py`:

```python
class Download(models.Model):
    turn = models.ForeignKey(Turn, on_delete=models.CASCADE, related_name="downloads")
    filename = models.CharField(max_length=255)   # basename only
    size = models.PositiveIntegerField()          # bytes on disk at scan time
    oversize = models.BooleanField(default=False) # True → not servable
    created_at = models.DateTimeField(auto_now_add=True)
```

Exported through `website/models/__init__.py`. Migration via `makemigrations`.

`on_delete=CASCADE` removes rows when the parent `Turn` / `Session` is
deleted. Filesystem cleanup is separate (see "Deletion" below).

## Backend changes

### `website/tasks.py`

Before invoking the klaude CLI, build the effective prompt:

```python
downloads_prefix = (
    f"[downloads — you can share files with the user by writing them to "
    f"downloads/{session.id}/{turn.id}/. "
    f"Max {MAX_FILES_PER_TURN} files, "
    f"{_fmt_size(MAX_SINGLE_FILE)} each, "
    f"{_fmt_size(MAX_TOTAL_UPLOAD)} total. "
    f"Files exceeding the per-file size will be shown to the user but "
    f"marked as too large to download.]\n\n"
)
```

If upload attachments exist, concatenate both prefixes (uploads first, then
downloads, then the user's original prompt). The DB `turn.prompt` stays the
user's original text; only `effective_prompt` carries the prefix.

After `_execute_klaude` returns with `status=done`, call
`_register_downloads(turn)`:

```python
def _register_downloads(turn):
    session = turn.session
    rel_dir = f"downloads/{session.id}/{turn.id}"
    assert re.fullmatch(r"downloads/\d+/\d+", rel_dir)
    abs_dir = os.path.join(WORKSPACE_BASE, session.workspace, rel_dir)

    result = subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "find", abs_dir,
         "-maxdepth", "1", "-type", "f", "-printf", "%f|%s\n"],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return  # dir missing or empty

    servable_total = 0
    created = 0
    for line in result.stdout.strip().split("\n"):
        name, size_str = line.rsplit("|", 1)
        size = int(size_str)
        if created >= MAX_FILES_PER_TURN:
            break
        oversize = size > MAX_SINGLE_FILE
        if not oversize and servable_total + size > MAX_TOTAL_UPLOAD:
            break
        Download.objects.create(
            turn=turn, filename=name, size=size, oversize=oversize,
        )
        if not oversize:
            servable_total += size
        created += 1
```

Called only when `turn.status == "done"`. Failed / cancelled turns do not
register downloads (files remain on disk and are cleaned up when the session
is deleted).

### `website/views/slops.py`

`_serialize_turn` adds:

```python
data["downloads"] = [
    {"id": d.id, "filename": d.filename, "size": d.size, "oversize": d.oversize}
    for d in t.downloads.all()
]
```

New public endpoint `slops_download(request, download_id)`:

```python
def slops_download(request, download_id):
    """GET /api/slops/downloads/<id>/ — public, streams the file bytes."""
    if request.method != "GET":
        return JsonResponse({"error": "GET required"}, status=405)
    try:
        d = Download.objects.select_related("turn__session").get(id=download_id)
    except Download.DoesNotExist:
        return JsonResponse({"error": "Not found"}, status=404)
    if d.oversize:
        return JsonResponse({"error": "File too large to download"}, status=403)

    session = d.turn.session
    rel = f"downloads/{session.id}/{d.turn.id}/{d.filename}"
    # Validate the directory part — filename is whatever klaude wrote but is a
    # stored value, not user-controlled path.
    assert re.fullmatch(r"downloads/\d+/\d+/.+", rel)
    abs_path = os.path.join(WORKSPACE_BASE, session.workspace, rel)

    proc = subprocess.Popen(
        ["sudo", "-u", KLAUDE_USER, "cat", abs_path],
        stdout=subprocess.PIPE,
    )
    response = StreamingHttpResponse(proc.stdout, content_type="application/octet-stream")
    response["Content-Disposition"] = (
        f'attachment; filename="{_ascii_fallback(d.filename)}"; '
        f"filename*=UTF-8''{quote(d.filename)}"
    )
    response["Content-Length"] = str(d.size)
    return response
```

`slops_delete` (session) adds a cleanup step alongside the existing cascade:

```python
rel = f"downloads/{session.id}"
if re.fullmatch(r"downloads/\d+", rel):
    subprocess.run(
        ["sudo", "-u", KLAUDE_USER, "rm", "-rf", "--",
         os.path.join(WORKSPACE_BASE, session.workspace, rel)],
        capture_output=True,
    )
```

### `website/urls.py`

One new route:

```python
path("slops/downloads/<int:download_id>/", views.slops_download, name="slops_download"),
```

## Frontend changes

### `frontend/src/lib/api.ts`

Extend `Turn` type:

```ts
export type Download = {
  id: number;
  filename: string;
  size: number;
  oversize: boolean;
};

// inside Turn:
downloads?: Download[];
```

### `frontend/src/app/slops/components/TraceViewer.tsx`

When an assistant turn has `downloads` with length > 0, render a chip row
directly below its message. Chip styling matches upload chips (bordered
monospace, muted background). Behavior:

- **Normal file:** anchor tag with `href={`${API}/api/slops/downloads/${id}/`}`
  and `download` attribute; label `${filename} · ${formatSize(size)} · ⬇`.
- **Oversize file:** plain `<span>` with label `${filename} · ${formatSize(size)} · (too large)` and muted text.

Uses the existing `formatSize` helper from `slopsLimits.ts` (introduced by
upload; if download lands first, introduce it here and upload picks it up).

No changes needed to `slops/page.tsx` — downloads are read-only artifacts
surfaced through the session detail response.

## Deletion / lifecycle

| Event | DB | Filesystem |
|---|---|---|
| Turn done | `Download` rows created | files kept |
| Turn failed / cancelled | no rows created | files kept (orphaned in dir) |
| Turn rejected | n/a (rejected means klaude never ran, no files exist) | nothing to clean |
| Session deleted | cascade via FK | `rm -rf downloads/<session_id>/` |

All `rm -rf` paths are validated against `re.fullmatch(r"downloads/\d+")`
before shelling out. Same defensive pattern used by `slops_cancel` and by the
upload design's `slops_reject`.

Orphaned files from failed turns accumulate until the session is deleted.
This is acceptable for personal-site scale and symmetric with how uploads
behave on failed turns.

## Security notes

- **Public endpoint serves klaude-written bytes.** The worst-case attack is a
  prompt engineered to make klaude copy secret files (e.g. `/etc/passwd`) into
  `downloads/`. Mitigations:
  1. **Admin approval is the primary gate.** Nam approves every non-admin
     turn personally. Such a prompt would be visibly suspicious at approval
     time.
  2. **Klaude's blast radius is limited to its user and workspace.** The
     `klaude` user cannot read files outside what its uid/gid allow, and
     cwd is fixed to the workspace for each turn.
  3. **Path validation.** Downloads are served only from the exact
     `downloads/<session_id>/<turn_id>/` tied to a real `Download` row, via
     regex-validated paths.
- **No inline rendering.** `Content-Type: application/octet-stream` and
  `Content-Disposition: attachment` prevent HTML/script files from being
  interpreted by the browser — no stored-XSS vector.
- **Filename sanitization at scan.** `find -printf '%f'` returns the basename
  only; no path component can reach the stored `filename`. On serve, the
  header uses both the quoted ASCII-fallback form and the RFC 5987
  `filename*` form for unicode.
- **Rate limiting.** Generating downloads is already rate-limited via the
  existing `slops_submit` caps (1/hr/IP, 10/hr global). No per-download rate
  limit is added; serving is a bounded read of a file with known size.
- **Disk fill.** Hard-capped at `MAX_TOTAL_UPLOAD` per turn. Per-session and
  global totals bounded by the submit rate limits.

## Testing

Backend (`website/tests/test_slops.py`):

- `test_register_downloads_single_file` — one file in dir → one `Download`
  row with correct filename/size/oversize=False.
- `test_register_downloads_respects_max_files` — 6 files → only first 5
  registered (order determined by `find` output; test asserts count).
- `test_register_downloads_respects_total_cap` — files summing over 10 MB →
  registration stops when cap would be exceeded.
- `test_register_downloads_marks_oversize` — single 6 MB file → row created
  with `oversize=True`.
- `test_register_downloads_skips_if_dir_missing` — no `downloads/` dir → no
  rows, no error.
- `test_download_endpoint_streams_bytes` — GET returns the file bytes.
- `test_download_endpoint_404_on_missing_row`.
- `test_download_endpoint_403_on_oversize`.
- `test_download_endpoint_sets_content_disposition_attachment`.
- `test_delete_session_cleans_up_downloads` — after session delete, the
  `downloads/<session_id>/` dir is removed.
- `test_prompt_prefix_includes_download_instructions` — unit-test the prefix
  builder.

Frontend:

- No new pure-function logic; limits and `formatSize` reused.
- Manual: visit a session detail page for a turn with registered downloads
  and confirm chips render + download works.

Manual QA (add to `docs/QA-CHECKLIST.md`):

- Submit a prompt like "write a short markdown file to
  `downloads/<session>/<turn>/hello.md` with three bullets". Approve.
  Turn completes → chip appears → click downloads the bytes.
- Prompt klaude to write 6 files → exactly 5 chips.
- Prompt klaude to write a 6 MB file → chip shows "(too large)" with no
  link.

## Out of scope (future follow-ups)

- Per-file delete from admin UI.
- Inline previews (image thumbnails, PDF first page, text preview).
- MIME sniffing / content-type detection for smarter `Content-Type` headers.
- Per-download rate limiting (if slops becomes popular enough for abuse).
- Cron sweep of orphan `downloads/` trees.
- Notifying klaude of which files it wrote were rejected for size.
