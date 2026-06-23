import { describe, expect, it } from "vitest";
import {
  apmSplitSegments,
  clipEmbedUrl,
  diamondCorners,
  fitMapViewBox,
  fmtMmss,
  formatDuration,
  formatUptime,
  gameSharePath,
  mapCoordToDiamond,
  mapCoordToSvg,
  mistakeTier,
  openingColor,
  resultLabel,
  tierStroke,
  timelineX,
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

describe("v2 viz helpers", () => {
  describe("fitMapViewBox", () => {
    it("fits a box over buildings + walls with margin", () => {
      const vb = fitMapViewBox(
        [
          { x: 30, y: 40 },
          { x: 50, y: 60 },
        ],
        [{ x: 20, y: 20, x_end: 70, y_end: 80 }],
        2,
      );
      expect(vb.minX).toBe(18); // min x 20 - margin 2
      expect(vb.minY).toBe(18);
      expect(vb.width).toBe(54); // (70+2) - 18
      expect(vb.height).toBe(64); // (80+2) - 18
    });
    it("falls back to mapDim box when empty", () => {
      expect(fitMapViewBox([], [], 4, 144)).toEqual({
        minX: 0,
        minY: 0,
        width: 144,
        height: 144,
      });
    });
    it("defaults to 120 box when empty and no mapDim", () => {
      const vb = fitMapViewBox([], []);
      expect(vb.width).toBe(120);
    });
    it("gives a coincident-point set a non-degenerate box", () => {
      const vb = fitMapViewBox([{ x: 50, y: 50 }], [], 4);
      expect(vb.width).toBeGreaterThan(0);
      expect(vb.height).toBeGreaterThan(0);
    });
    it("clamps to [0, mapDim]", () => {
      const vb = fitMapViewBox([{ x: 2, y: 2 }], [], 10, 120);
      expect(vb.minX).toBe(0);
      expect(vb.minY).toBe(0);
    });
  });

  describe("mapCoordToSvg", () => {
    const vb = { minX: 0, minY: 0, width: 100, height: 100 };
    it("projects origin to (0,0)", () => {
      expect(mapCoordToSvg(0, 0, vb, 200)).toEqual({ px: 0, py: 0 });
    });
    it("projects max extent to svgSize", () => {
      expect(mapCoordToSvg(100, 100, vb, 200)).toEqual({ px: 200, py: 200 });
    });
    it("clamps out-of-range coords", () => {
      const p = mapCoordToSvg(-50, 500, vb, 200);
      expect(p.px).toBe(0);
      expect(p.py).toBe(200);
    });
  });

  describe("timelineX", () => {
    it("maps t_s to a fraction of width", () => {
      expect(timelineX(150, 300, 600)).toBe(300);
    });
    it("clamps t beyond duration", () => {
      expect(timelineX(400, 300, 600)).toBe(600);
    });
    it("guards zero duration", () => {
      expect(timelineX(100, 0, 600)).toBe(0);
    });
  });

  describe("apmSplitSegments", () => {
    it("splits eco/military/other as fractions", () => {
      const s = apmSplitSegments(30, 20, 100);
      expect(s.eco).toBeCloseTo(0.3);
      expect(s.military).toBeCloseTo(0.2);
      expect(s.other).toBeCloseTo(0.5);
    });
    it("guards zero/nullish total", () => {
      expect(apmSplitSegments(10, 5, 0)).toEqual({
        eco: 0,
        military: 0,
        other: 0,
      });
      expect(apmSplitSegments(null, null, null)).toEqual({
        eco: 0,
        military: 0,
        other: 0,
      });
    });
    it("never goes negative when eco+mil exceed total", () => {
      const s = apmSplitSegments(80, 80, 100);
      expect(s.other).toBe(0);
    });
  });

  describe("tierStroke", () => {
    it("exact is solid full opacity", () => {
      expect(tierStroke("exact")).toEqual({ strokeDasharray: "0", opacity: 1 });
    });
    it("est is dashed reduced opacity", () => {
      const t = tierStroke("est");
      expect(t.strokeDasharray).not.toBe("0");
      expect(t.opacity).toBeLessThan(1);
    });
    it("unavailable is faint", () => {
      expect(tierStroke("unavailable").opacity).toBeLessThan(0.5);
    });
  });

  describe("mistakeTier", () => {
    it("maps confidence tiers to viz tiers", () => {
      expect(mistakeTier("exact")).toBe("exact");
      expect(mistakeTier("heuristic")).toBe("est");
      expect(mistakeTier("needs-#2")).toBe("unavailable");
      expect(mistakeTier(undefined)).toBe("unavailable");
    });
  });

  describe("fmtMmss", () => {
    it("formats seconds as m:ss", () => {
      expect(fmtMmss(715)).toBe("11:55");
      expect(fmtMmss(0)).toBe("0:00");
    });
    it("dashes nullish", () => {
      expect(fmtMmss(null)).toBe("—");
      expect(fmtMmss(undefined)).toBe("—");
    });
  });
});

describe("mapCoordToDiamond (wide isometric minimap)", () => {
  const M = 120;
  const W = 320;
  const H = 160;

  it("maps the four world corners to N/E/S/W of a 2:1 diamond", () => {
    expect(mapCoordToDiamond(0, 0, M, W, H)).toEqual({ px: 160, py: 0 }); // top / North
    expect(mapCoordToDiamond(M, M, M, W, H)).toEqual({ px: 160, py: 160 }); // bottom / South
    expect(mapCoordToDiamond(M, 0, M, W, H)).toEqual({ px: 0, py: 80 }); // left / West
    expect(mapCoordToDiamond(0, M, M, W, H)).toEqual({ px: 320, py: 80 }); // right / East
  });

  it("places game-2 bases correctly: ME west of OPP, OPP further south", () => {
    const me = mapCoordToDiamond(49.7, 28.9, M, W, H); // Burgundians (nom)
    const opp = mapCoordToDiamond(35, 90, M, W, H); // Bengalis
    expect(me.px).toBeLessThan(W / 2); // ME on the west half
    expect(opp.px).toBeGreaterThan(me.px); // OPP further east
    expect(opp.py).toBeGreaterThan(me.py); // OPP further south  -> south-east
  });

  it("defaults mapDim to 120 when missing and clamps in-bounds", () => {
    const p = mapCoordToDiamond(60, 60, null, W, H);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(W);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(H);
  });

  it("diamondCorners lists N,E,S,W for the box", () => {
    expect(diamondCorners(320, 160)).toBe("160,0 320,80 160,160 0,80");
  });
});
