import { describe, expect, it } from "vitest";
import { ENTRIES } from "../grindsData";

describe("grinds ENTRIES data", () => {
  it("every entry has a non-empty URL", () => {
    for (const entry of ENTRIES) {
      expect(entry.url, `${entry.org} should have a URL`).toBeTruthy();
    }
  });

  it("every URL starts with https://", () => {
    for (const entry of ENTRIES) {
      expect(entry.url, `${entry.org} URL should be https`).toMatch(/^https:\/\//);
    }
  });

  it("every entry has at least one tag", () => {
    for (const entry of ENTRIES) {
      expect(entry.tags.length, `${entry.org} should have tags`).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty org name", () => {
    for (const entry of ENTRIES) {
      expect(entry.org).toBeTruthy();
    }
  });

  it("sides alternate (no two consecutive same-side entries)", () => {
    for (let i = 1; i < ENTRIES.length; i++) {
      expect(
        ENTRIES[i].side,
        `entries ${i - 1} and ${i} should alternate sides`,
      ).not.toBe(ENTRIES[i - 1].side);
    }
  });
});
