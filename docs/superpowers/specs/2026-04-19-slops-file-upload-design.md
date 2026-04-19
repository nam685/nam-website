# Slops file upload — design

**Date:** 2026-04-19
**Status:** approved
**Related:** [klaude#14](https://github.com/nam685/klaude/issues/14) (klaude binary-file support)

## Goal

Let visitors attach files to a `/slops` prompt. The files are stored inside the klaude workspace so klaude can read them with its existing `read_file` / `bash` tools. The admin (Nam) still approves every non-admin turn before klaude runs, so approval is the primary safety gate.

## Non-goals

- Binary-format parsing on the backend (PDF/Word/Excel/images). Tracked separately in klaude#14. For v1, klaude only natively handles text; binary files are stored and referenced, and will "just work" once klaude#14 ships.
- Generic file hosting. Uploads are tied to a single turn and deleted with it.
- Virus scanning, MIME sniffing beyond extension check.

## User flow

1. User types a prompt on `/slops`. Left of the input is a `+` icon.
2. Clicking `+` opens the native file picker (multi-select allowed).
3. Picked files appear as chips above the input: `name.ext · 12.3 KB · ✕`. `✕` removes a single file from the pending attachment list.
4. Client validates total size and per-file size. Any violation shows an inline error and blocks send.
5. Submit: if files are attached, request is `multipart/form-data`; otherwise stays JSON (unchanged).
6. Successful submit clears the prompt and attachment list, same as today.
7. Rendered turn shows attachment names below the prompt so later readers know what was supplied.

## Limits (v1)

Single source of truth: constants in `website/views/slops.py`, mirrored as client-side constants in `frontend/src/lib/slopsLimits.ts`.

- `MAX_FILES_PER_TURN = 5`
- `MAX_SINGLE_FILE = 5 * 1024 * 1024` (5 MB)
- `MAX_TOTAL_UPLOAD = 10 * 1024 * 1024` (10 MB per turn)
- Extension allowlist (case-insensitive):
  - Text/code: `.txt .md .json .yaml .yml .csv .tsv .log .py .js .ts .tsx .jsx .html .css .sh .toml .xml .sql`
  - Binary (deferred parsing): `.pdf .png .jpg .jpeg .gif .webp .heic .docx .xlsx .pptx`
- Filename: server strips path separators, keeps only `basename`. If basename is empty or starts with `.`, reject.

Server returns `413 Payload Too Large` on size violations, `400` on extension/filename violations. Error body: `{"error": "..."}` with a human-readable message the frontend surfaces verbatim.

## Storage layout

Files live inside the klaude workspace so klaude can reference them with relative paths.

```
/home/klaude/workspace/klaude-playground/
  uploads/
    <session_id>/
      <turn_id>/
        <filename>
        <filename>
```

- Owned by the `klaude` user (Django writes via `sudo -u klaude tee -- <path>`, same pattern as existing `_execute_klaude` which uses `sudo -u klaude mkdir -p`).
- Relative path klaude sees (cwd is the workspace): `uploads/<session_id>/<turn_id>/<filename>`.

## Data model

New model `website/models/attachment.py`:

```python
class Attachment(models.Model):
    turn = models.ForeignKey(Turn, on_delete=models.CASCADE, related_name="attachments")
    filename = models.CharField(max_length=255)  # basename only
    size = models.PositiveIntegerField()          # bytes
    content_type = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

Exported through `website/models/__init__.py`. Migration generated via `makemigrations`.

Note: `on_delete=CASCADE` removes rows when a session/turn is deleted. Filesystem cleanup is separate (see "Deletion" below).

## Backend changes

### `website/views/slops.py`

`slops_submit`:
- Detect content-type. If `multipart/form-data`, read `prompt` / `session_id` from `request.POST`; otherwise keep existing JSON path.
- After prompt validation and session resolution, if `request.FILES.getlist("files")` is non-empty:
  - Enforce `MAX_FILES_PER_TURN`, each file's `MAX_SINGLE_FILE`, sum `<= MAX_TOTAL_UPLOAD`.
  - Validate extension allowlist + basename.
  - Create the `Turn` **first** (so we have `turn.id`), then for each file:
    - Compute dest dir `uploads/<session.id>/<turn.id>/` under workspace.
    - `sudo -u klaude mkdir -p <dest>` once per turn.
    - Pipe bytes via `sudo -u klaude tee -- <dest>/<basename>` in a `subprocess.run` call, passing the `UploadedFile` chunks to stdin.
    - Create `Attachment` row.
  - If anything fails mid-loop, run `sudo -u klaude rm -rf <turn_dir>` and delete the `Turn` + `Attachment` rows, return `500`.

`_serialize_turn` adds `attachments: [{id, filename, size, previewable}]`. `previewable` is `True` iff the extension is in the text/code subset of the allowlist.

New endpoint `slops_attachment_preview` — `GET /api/slops/attachments/<attachment_id>/preview/`:
- Admin-only (`require_admin`).
- 404 if the attachment row is missing or the extension is not in the text/code allowlist.
- Reads the file via `sudo -u klaude cat -- <path>` (path validated against `uploads/\d+/\d+/<basename>`).
- Caps response at `PREVIEW_MAX_BYTES = 64 * 1024` (64 KB). If the file is larger, truncate and append a `\n[truncated — showing first 64 KB of NNN KB]` footer.
- Returns `{"content": "...", "truncated": bool, "total_size": int}` with `Content-Type: application/json`. Never returns raw bytes — if decoding as UTF-8 fails, return `{"error": "Not valid UTF-8 text"}` with 400, so a file with a `.txt` rename-trick can't bypass the text-only guarantee.

`slops_reject`: after marking turn rejected, call `_cleanup_turn_uploads(turn)` — validate the computed path against the `uploads/<digits>/<digits>` regex, then `sudo -u klaude rm -rf`.

`slops_delete` (session): after DB delete, `_cleanup_session_uploads(session)` — same pattern, removes `uploads/<session_id>/`.

### `website/tasks.py`

In `_execute_klaude`, before invoking the klaude CLI:

```python
attachments = list(turn.attachments.all())
if attachments:
    lines = [f"- uploads/{session.id}/{turn.id}/{a.filename} ({_fmt_size(a.size)})" for a in attachments]
    prompt_prefix = "[attachments — read these first]\n" + "\n".join(lines) + "\n\n"
    effective_prompt = prompt_prefix + turn.prompt
else:
    effective_prompt = turn.prompt
```

`effective_prompt` is the one passed to klaude; the DB `turn.prompt` stays the user's original text.

## Frontend changes

### `frontend/src/lib/slopsLimits.ts` (new)
Export the same constants (`MAX_FILES_PER_TURN`, etc.), ALLOWED_EXTENSIONS set, and `formatSize(bytes)` helper.

### `frontend/src/app/slops/page.tsx`
- New state: `pendingFiles: File[]`, `fileError: string | null`.
- `+` button (styled as a bordered monospace glyph matching the send button) triggers a hidden `<input type="file" multiple>`.
- File picker `onChange`:
  - Merge with existing `pendingFiles` (dedupe by name+size).
  - Run the same limit checks as server. On violation, set `fileError`, reject the whole batch.
- Chip row above input renders `pendingFiles`. Each chip has a `✕` that removes itself.
- `handleSubmit`:
  - If `pendingFiles.length === 0`: existing JSON flow.
  - Else: build `FormData`, append `prompt`, optional `session_id`, and each file under key `files`. `fetch` without setting `Content-Type` (browser sets the multipart boundary).
- After successful submit: clear `pendingFiles` and `fileError`.
- Disable `+` button while `hasActiveTurn`.

### `frontend/src/lib/api.ts`
Extend `Turn` type with optional `attachments: { filename: string; size: number }[]`.

### `frontend/src/app/slops/components/TraceViewer.tsx`
When a turn has attachments, render a compact list under the user message (e.g. `attached: foo.csv (12.3 KB)`) so the context is visible in the trace UI.

For admins only, text-file attachments are clickable — clicking expands an inline preview (monospace, max-height scrollable `<pre>`) fetched from `/api/slops/attachments/<id>/preview/`. Binary attachments (`.pdf`, `.png`, `.docx`, etc.) show name + size only, no preview affordance. Non-admin viewers see the attachment list without any preview links, regardless of type. The preview is purely an admin review tool to eyeball content for malicious scripts before approving the turn.

## Deletion / lifecycle

| Event | DB | Filesystem |
|---|---|---|
| Turn rejected | `status=rejected` | `rm -rf uploads/<session_id>/<turn_id>/` |
| Session deleted | cascade via FK | `rm -rf uploads/<session_id>/` |
| Turn done/failed | unchanged | files kept (useful for trace replay) |
| Session purge (future) | n/a | covered by session deletion |

All `rm -rf` paths are validated against `re.fullmatch(r"uploads/\d+(/\d+)?", rel_path)` before shelling out. Same defensive pattern used in `slops_cancel`'s `pkill`.

## Security notes

- **Uploaded bytes are never executed.** Files are written, not run. Klaude reads them via `read_file` (`Path.read_text()`) or `bash cat`, both of which are reads. Code execution would require klaude to explicitly `bash ./foo.sh` — which (a) requires a prompt that goads it into doing so and (b) requires admin approval of that turn.
- **Admin approval is the primary gate.** Nam approves every non-admin turn personally. A malicious upload sitting on disk does nothing until a turn runs.
- **Path traversal:** basename stripped server-side; no user-controlled path components reach the filesystem.
- **Rate limiting:** existing 1/hr/IP + 10/hr global submit limits cover upload abuse. A single spammer can deposit at most `10 * MAX_TOTAL_UPLOAD = 100 MB/hr` globally even with admin-approval bypass, which is acceptable for personal-site scale.
- **Disk fill:** each session's uploads cleaned up on session delete. Consider a cron-driven sweep of orphaned dirs as a future follow-up if this ever matters.

## Testing

Backend (`website/tests/test_slops.py`):
- `test_submit_with_files_stores_attachments` — multipart submit creates Attachment rows + files on disk (use tmpfs / mock the sudo call).
- `test_submit_rejects_oversize_single`, `_oversize_total`, `_too_many_files`, `_disallowed_extension`, `_empty_basename`.
- `test_reject_cleans_up_uploads` — uploaded files removed after reject.
- `test_delete_session_cleans_up_uploads`.
- `test_prompt_prefix_injected` — unit-test the prefix builder in `tasks.py`.
- `test_attachment_preview_requires_admin`, `_returns_content_for_text`, `_404_for_binary`, `_truncates_large_files`, `_rejects_non_utf8`.

Frontend (`frontend/src/lib/__tests__/slopsLimits.test.ts`):
- Pure-function tests for the client-side validator (edge cases around the size limits).

Manual (add to `docs/QA-CHECKLIST.md`):
- Upload one file, two files, max files, over max — all behave correctly.
- Upload, then reject — check disk cleanup on server (document as admin QA step).
- Upload during an active turn → `+` disabled.
- Upload 6 MB single → rejected client-side before network.

## Out of scope (future follow-ups)

- Per-IP upload quota separate from per-turn.
- Antivirus scan.
- Preview of binary attachments (image thumbnails, PDF first page). Text previews are in scope; binary previews are not.
- Streamed uploads for files larger than the 10 MB cap.
- Orphan-dir sweep cron.
