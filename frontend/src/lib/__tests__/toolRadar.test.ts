import { describe, it, expect } from "vitest";
import {
  groupToolsByStatus,
  formatStarCount,
  TOOL_TABS,
  DEFAULT_TOOL_TAB,
} from "../toolRadar";
import type { TrackedTool } from "../api";

function makeTool(overrides: Partial<TrackedTool>): TrackedTool {
  return {
    id: 1,
    name: "herdr",
    url: "https://herdr.dev",
    description: "",
    category: "personal-agent-runtimes",
    status: "watching",
    is_new: false,
    source: "manual",
    notes: "",
    stars: null,
    added_at: "2026-07-26T00:00:00Z",
    last_reviewed_at: "2026-07-26T00:00:00Z",
    is_stale: false,
    ...overrides,
  };
}

describe("TOOL_TABS / DEFAULT_TOOL_TAB", () => {
  it("has three tabs with adopted as default", () => {
    expect(TOOL_TABS).toEqual(["watching", "adopted", "dropped"]);
    expect(DEFAULT_TOOL_TAB).toBe("adopted");
  });
});

describe("groupToolsByStatus", () => {
  it("groups by status", () => {
    const tools = [
      makeTool({ id: 1, status: "watching" }),
      makeTool({ id: 2, status: "adopted" }),
      makeTool({ id: 3, status: "dropped" }),
      makeTool({ id: 4, status: "watching" }),
    ];
    const groups = groupToolsByStatus(tools);
    expect(groups.watching.map((t) => t.id)).toEqual([1, 4]);
    expect(groups.adopted.map((t) => t.id)).toEqual([2]);
    expect(groups.dropped.map((t) => t.id)).toEqual([3]);
  });

  it("returns empty arrays for statuses with no tools", () => {
    const groups = groupToolsByStatus([]);
    expect(groups.watching).toEqual([]);
    expect(groups.adopted).toEqual([]);
    expect(groups.dropped).toEqual([]);
  });

  it("surfaces is_new entries first within a group", () => {
    const tools = [
      makeTool({ id: 1, status: "watching", is_new: false }),
      makeTool({ id: 2, status: "watching", is_new: true }),
      makeTool({ id: 3, status: "watching", is_new: false }),
    ];
    const groups = groupToolsByStatus(tools);
    expect(groups.watching[0].id).toBe(2);
  });

  it("sorts by stars descending within is_new groups", () => {
    const tools = [
      makeTool({ id: 1, status: "watching", is_new: false, stars: 10 }),
      makeTool({ id: 2, status: "watching", is_new: false, stars: 500 }),
      makeTool({ id: 3, status: "watching", is_new: false, stars: 100 }),
    ];
    const groups = groupToolsByStatus(tools);
    expect(groups.watching.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it("sorts manual entries with null stars last within their is_new group", () => {
    const tools = [
      makeTool({ id: 1, status: "watching", is_new: false, stars: null }),
      makeTool({ id: 2, status: "watching", is_new: false, stars: 5 }),
    ];
    const groups = groupToolsByStatus(tools);
    expect(groups.watching.map((t) => t.id)).toEqual([2, 1]);
  });

  it("keeps is_new as the primary sort ahead of star count", () => {
    const tools = [
      makeTool({ id: 1, status: "watching", is_new: false, stars: 99999 }),
      makeTool({ id: 2, status: "watching", is_new: true, stars: 1 }),
    ];
    const groups = groupToolsByStatus(tools);
    expect(groups.watching.map((t) => t.id)).toEqual([2, 1]);
  });
});

describe("formatStarCount", () => {
  it("returns empty string for null", () => {
    expect(formatStarCount(null)).toBe("");
  });

  it("returns raw number under 1000", () => {
    expect(formatStarCount(0)).toBe("0");
    expect(formatStarCount(999)).toBe("999");
  });

  it("formats thousands with one decimal", () => {
    expect(formatStarCount(1234)).toBe("1.2k");
    expect(formatStarCount(59996)).toBe("60.0k");
  });
});
