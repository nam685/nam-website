import { describe, expect, it } from "vitest";
import { buildExcludeList, RADIO_EXCLUDE_CAP, shouldTopUp } from "@/lib/radio";
import type { ListenTrack } from "@/lib/api";

function track(video_id: string): ListenTrack {
  return {
    id: 0,
    video_id,
    title: video_id,
    artist: "",
    album: "",
    thumbnail_url: "",
    duration: "",
    played_at: "",
  };
}

describe("shouldTopUp", () => {
  it("is false when radio is off", () => {
    expect(shouldTopUp(1, 0, false)).toBe(false);
  });
  it("is false when no track is selected", () => {
    expect(shouldTopUp(5, -1, true)).toBe(false);
  });
  it("is true when 2 or fewer tracks remain ahead", () => {
    expect(shouldTopUp(3, 0, true)).toBe(true); // 2 remaining
    expect(shouldTopUp(1, 0, true)).toBe(true); // 0 remaining
  });
  it("is false when more than 2 tracks remain ahead", () => {
    expect(shouldTopUp(5, 0, true)).toBe(false); // 4 remaining
  });
});

describe("buildExcludeList", () => {
  it("returns most-recent video ids first, deduped", () => {
    const q = [track("a"), track("b"), track("a"), track("c")];
    expect(buildExcludeList(q)).toEqual(["c", "a", "b"]);
  });
  it("caps the list length", () => {
    const q = Array.from({ length: RADIO_EXCLUDE_CAP + 10 }, (_, i) => track(`v${i}`));
    expect(buildExcludeList(q)).toHaveLength(RADIO_EXCLUDE_CAP);
  });
});
