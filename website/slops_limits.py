"""Shared constants for slops file-upload limits. Mirror in frontend/src/lib/slopsLimits.ts."""

MAX_FILES_PER_TURN = 5
MAX_SINGLE_FILE = 5 * 1024 * 1024  # 5 MB
MAX_TOTAL_UPLOAD = 10 * 1024 * 1024  # 10 MB per turn
PREVIEW_MAX_BYTES = 64 * 1024  # 64 KB

# Extensions split into "text/code" (previewable) and "binary" (storage only for now).
TEXT_EXTENSIONS = frozenset(
    {
        ".txt",
        ".md",
        ".json",
        ".yaml",
        ".yml",
        ".csv",
        ".tsv",
        ".log",
        ".py",
        ".js",
        ".ts",
        ".tsx",
        ".jsx",
        ".html",
        ".css",
        ".sh",
        ".toml",
        ".xml",
        ".sql",
    }
)
BINARY_EXTENSIONS = frozenset({".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".docx", ".xlsx", ".pptx"})
ALLOWED_EXTENSIONS = TEXT_EXTENSIONS | BINARY_EXTENSIONS
