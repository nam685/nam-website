import type { ToolStatus, TrackedTool } from "@/lib/api";

export const TOOL_TABS: ToolStatus[] = ["watching", "adopted", "dropped"];
export const DEFAULT_TOOL_TAB: ToolStatus = "adopted";

/** Group tools by status for the tab strip; within a group, new/unreviewed feed entries surface
 * first, then most-starred first (manual entries with no star count sort last). */
export function groupToolsByStatus(
  tools: TrackedTool[],
): Record<ToolStatus, TrackedTool[]> {
  const groups: Record<ToolStatus, TrackedTool[]> = {
    watching: [],
    adopted: [],
    dropped: [],
  };
  for (const tool of tools) {
    groups[tool.status].push(tool);
  }
  for (const status of TOOL_TABS) {
    groups[status].sort((a, b) => {
      const isNewDiff = Number(b.is_new) - Number(a.is_new);
      if (isNewDiff !== 0) return isNewDiff;
      return (b.stars ?? -1) - (a.stars ?? -1);
    });
  }
  return groups;
}

/** Compact star count for display, e.g. 1234 -> "1.2k", 59996 -> "60.0k". */
export function formatStarCount(stars: number | null): string {
  if (stars === null) return "";
  if (stars < 1000) return String(stars);
  return `${(stars / 1000).toFixed(1)}k`;
}
