import { describe, expect, it } from "vitest";
import {
  clipEmbedUrl,
  formatDuration,
  formatUptime,
  gameSharePath,
  openingColor,
  resultLabel,
} from "../aoe2";

describe("aoe2 helpers", () => {
  it("formats duration mm:ss", () => {
    expect(formatDuration(1471)).toBe("24:31");
    expect(formatDuration(0)).toBe("00:00");
  });
  it("formats uptime with dash for null", () => {
    expect(formatUptime(null)).toBe("—");
    expect(formatUptime(150)).toBe("2:30");
  });
  it("maps result to label", () => {
    expect(resultLabel("win")).toBe("Victory");
    expect(resultLabel("loss")).toBe("Defeat");
    expect(resultLabel("unknown")).toBe("—");
  });
  it("returns a hex color for openings", () => {
    expect(openingColor("Archers")).toMatch(/^#/);
    expect(openingColor("anything")).toMatch(/^#/);
  });
  it("builds a game share path", () => {
    expect(gameSharePath(42)).toBe("/plays?game=42");
  });
});

describe("clipEmbedUrl", () => {
  it("converts youtube.com/watch?v= to embed URL", () => {
    expect(clipEmbedUrl("https://www.youtube.com/watch?v=abc123")).toBe(
      "https://www.youtube.com/embed/abc123",
    );
  });

  it("converts youtu.be short URL to embed URL", () => {
    expect(clipEmbedUrl("https://youtu.be/xyz789")).toBe(
      "https://www.youtube.com/embed/xyz789",
    );
  });

  it("converts Twitch VOD URL", () => {
    expect(
      clipEmbedUrl("https://www.twitch.tv/videos/123456789", "nam685.de"),
    ).toBe("https://player.twitch.tv/?video=123456789&parent=nam685.de");
  });

  it("converts clips.twitch.tv clip URL", () => {
    expect(
      clipEmbedUrl("https://clips.twitch.tv/FancySlugHere", "nam685.de"),
    ).toBe("https://player.twitch.tv/?clip=FancySlugHere&parent=nam685.de");
  });

  it("converts twitch.tv/<channel>/clip/<slug> URL", () => {
    expect(
      clipEmbedUrl(
        "https://www.twitch.tv/nomstreamer/clip/AmazingPlay",
        "nam685.de",
      ),
    ).toBe("https://player.twitch.tv/?clip=AmazingPlay&parent=nam685.de");
  });

  it("returns URL unchanged for unrecognised host", () => {
    const url = "https://example.com/video";
    expect(clipEmbedUrl(url)).toBe(url);
  });

  it("returns already-embed URLs unchanged", () => {
    const embed = "https://www.youtube.com/embed/abc123";
    expect(clipEmbedUrl(embed)).toBe(embed);
  });

  it("returns empty string unchanged", () => {
    expect(clipEmbedUrl("")).toBe("");
  });

  it("returns invalid URL unchanged", () => {
    expect(clipEmbedUrl("not-a-url")).toBe("not-a-url");
  });
});
