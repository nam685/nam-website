// Mirror of website/slops_limits.py — keep numbers in sync.

export const MAX_FILES_PER_TURN = 5;
export const MAX_SINGLE_FILE = 5 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD = 10 * 1024 * 1024;

export const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".tsv", ".log",
  ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".sh",
  ".toml", ".xml", ".sql",
]);
export const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic",
  ".docx", ".xlsx", ".pptx",
]);
export const ALLOWED_EXTENSIONS = new Set([
  ...TEXT_EXTENSIONS,
  ...BINARY_EXTENSIONS,
]);

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export type ValidateResult = { ok: true } | { ok: false; error: string };

export function validateFiles(files: File[]): ValidateResult {
  if (files.length > MAX_FILES_PER_TURN) {
    return { ok: false, error: `Too many files (max ${MAX_FILES_PER_TURN})` };
  }
  let total = 0;
  for (const f of files) {
    if (!f.name || f.name.startsWith(".") || !f.name.includes(".")) {
      return { ok: false, error: `Invalid filename: ${f.name || "(empty)"}` };
    }
    const ext = extOf(f.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return { ok: false, error: `Extension ${ext} not allowed` };
    }
    if (f.size > MAX_SINGLE_FILE) {
      return {
        ok: false,
        error: `File '${f.name}' too large (max ${MAX_SINGLE_FILE / (1024 * 1024)} MB)`,
      };
    }
    total += f.size;
    if (total > MAX_TOTAL_UPLOAD) {
      return {
        ok: false,
        error: `Total upload size too large (max ${MAX_TOTAL_UPLOAD / (1024 * 1024)} MB)`,
      };
    }
  }
  return { ok: true };
}
