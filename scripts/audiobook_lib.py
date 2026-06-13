"""Pure helpers for the audiobook preprocessing pipeline."""

import re


def clean_pdf_text(raw: str) -> str:
    """Clean text extracted from a PDF for TTS narration."""
    s = raw
    s = re.sub(r"-\n([a-zA-Z])", r"\1", s)  # rejoin hyphenated line breaks
    s = re.sub(r"^\s*\d{1,4}\s*$", "", s, flags=re.M)  # drop standalone page numbers
    s = re.sub(r"https?://\S+", "", s)  # strip URLs
    s = re.sub(r"[—–]", ", ", s)  # em/en dash → natural pause
    s = s.replace("…", "...")
    s = s.replace(" ", " ")  # NBSP → space
    s = re.sub(r"[ \t]+", " ", s)
    lines = [line.strip() for line in s.split("\n")]
    s = "\n".join(lines)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


_SENTENCE_RE = re.compile(r"[^.!?\n]+[.!?\n]*", re.MULTILINE)


def chunk_paragraphs(text: str, target_len: int = 600, max_len: int = 1500) -> list[str]:
    """Split text into chunks at sentence boundaries, ~target_len chars each.

    Never exceed max_len. If a single sentence is longer than max_len, split on
    the nearest space inside the window.
    """
    if not text.strip():
        return []
    sentences = [m.group(0).strip() for m in _SENTENCE_RE.finditer(text) if m.group(0).strip()]
    chunks: list[str] = []
    cur = ""
    for sent in sentences:
        if len(sent) > max_len:
            words = sent.split(" ")
            buf = ""
            for w in words:
                if len(buf) + len(w) + 1 > max_len:
                    chunks.append(buf.strip())
                    buf = w
                else:
                    buf = f"{buf} {w}" if buf else w
            if buf:
                chunks.append(buf.strip())
            continue
        candidate = f"{cur} {sent}".strip() if cur else sent
        if len(candidate) > max_len or (cur and len(candidate) > target_len):
            chunks.append(cur)
            cur = sent
        else:
            cur = candidate
    if cur:
        chunks.append(cur)
    return [c for c in chunks if c]
