export const MAX_FILES_PER_TURN = 5;
export const MAX_SINGLE_FILE = 5 * 1024 * 1024;
export const MAX_TOTAL_UPLOAD = 10 * 1024 * 1024;

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
