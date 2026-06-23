import { describe, expect, it } from "vitest";
import {
  apmSplitSegments,
  buildProductionSeries,
  buildResourceBalanceChart,
  buildWorkerAllocChart,
  niceTicks,
  lightenHex,
  type BuildSummary,
  type ResourceBalance,
  type WorkerAllocation,
  buildFamilyLabel,
  buildPhaseLanes,
  clipEmbedUrl,
  diamondCorners,
  fitMapViewBox,
  fmtMmss,
  formatDuration,
  formatUptime,
  gameSharePath,
  groupBuildsByFamily,
  mapCoordToDiamond,
  mapCoordToSvg,
  mistakeTier,
  openingColor,
  parseInline,
  parseMarkdown,
  resultLabel,
  sanitizeCoachText,
  stepIconName,
  stripCoachScaffolding,
  tcIdlePct,
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
    expect(gameSharePath(42)).toBe("/plays/aoe2?game=42");
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
    expect(mapCoordToDiamond(M, 0, M, W, H)).toEqual({ px: 160, py: 0 }); // top / North
    expect(mapCoordToDiamond(0, M, M, W, H)).toEqual({ px: 160, py: 160 }); // bottom / South
    expect(mapCoordToDiamond(0, 0, M, W, H)).toEqual({ px: 0, py: 80 }); // left / West
    expect(mapCoordToDiamond(M, M, M, W, H)).toEqual({ px: 320, py: 80 }); // right / East
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

describe("sanitizeCoachText", () => {
  it("returns empty for nullish", () => {
    expect(sanitizeCoachText(null)).toBe("");
    expect(sanitizeCoachText(undefined)).toBe("");
    expect(sanitizeCoachText("")).toBe("");
  });

  it("strips a leading agent preamble line", () => {
    const raw =
      "Now I have all I need. Here is the coaching report:\n\n## Opening\nYou went Scouts.";
    expect(sanitizeCoachText(raw)).toBe("## Opening\nYou went Scouts.");
  });

  it("strips the real 'Now I have all the data. Let me compose the report.' preamble", () => {
    const raw =
      "Now I have all the data. Let me compose the report.\n\n## What happened\nYou won.";
    expect(sanitizeCoachText(raw)).toBe("## What happened\nYou won.");
  });

  it("strips a standalone 'Here is the report:' preamble", () => {
    const raw = "Here is the report:\n\nYou idled your TC.";
    expect(sanitizeCoachText(raw)).toBe("You idled your TC.");
  });

  it("strips a trailing sign-off", () => {
    const raw = "Solid game overall.\n\nHope this helps! Good luck.";
    expect(sanitizeCoachText(raw)).toBe("Solid game overall.");
  });

  it("never alters the analysis body", () => {
    const body =
      "## Feudal\nYour TC idled 38%.\n\n- Add a second TC\n- Wall your base";
    expect(sanitizeCoachText(body)).toBe(body);
  });

  it("does not strip a body line that merely mentions a report", () => {
    const raw = "The game report from your last match shows good macro.";
    expect(sanitizeCoachText(raw)).toBe(raw);
  });

  it("trims surrounding blank lines", () => {
    expect(sanitizeCoachText("\n\n  real content  \n\n")).toBe("real content");
  });
});

describe("tcIdlePct", () => {
  it("computes pre-cap idle percentage rounded", () => {
    expect(tcIdlePct(765, 2805)).toBe(27);
    expect(tcIdlePct(0, 2805)).toBe(0);
    expect(tcIdlePct(2805, 2805)).toBe(100);
  });
  it("clamps over-window idle to 100 and floors at 0", () => {
    expect(tcIdlePct(3000, 2805)).toBe(100);
  });
  it("returns null when the window is missing or zero", () => {
    expect(tcIdlePct(100, null)).toBeNull();
    expect(tcIdlePct(100, 0)).toBeNull();
    expect(tcIdlePct(null, 2805)).toBeNull();
  });
});

describe("stripCoachScaffolding", () => {
  it("returns empty string for nullish input", () => {
    expect(stripCoachScaffolding(null)).toBe("");
    expect(stripCoachScaffolding(undefined)).toBe("");
  });
  it("unwraps a tagged final block", () => {
    expect(
      stripCoachScaffolding("<final>\n## Verdict\nGood game\n</final>"),
    ).toBe("## Verdict\nGood game");
  });
  it("unwraps a fenced markdown block wrapping the whole body", () => {
    expect(stripCoachScaffolding("```markdown\nHello **world**\n```")).toBe(
      "Hello **world**",
    );
  });
  it("drops leading agent tool-noise lines", () => {
    expect(
      stripCoachScaffolding(
        "Reading facts.json…\nThinking about the game.\n## Verdict\nNice",
      ),
    ).toBe("## Verdict\nNice");
  });
  it("leaves already-clean text unchanged (idempotent)", () => {
    const clean = "## Verdict\nYou went archers.";
    expect(stripCoachScaffolding(clean)).toBe(clean);
    expect(stripCoachScaffolding(stripCoachScaffolding(clean))).toBe(clean);
  });
});

describe("parseInline", () => {
  it("splits bold and code runs from text", () => {
    expect(parseInline("hit **18** vils with `Loom`")).toEqual([
      { t: "text", v: "hit " },
      { t: "bold", v: "18" },
      { t: "text", v: " vils with " },
      { t: "code", v: "Loom" },
    ]);
  });
  it("returns a single text span for plain lines", () => {
    expect(parseInline("plain line")).toEqual([{ t: "text", v: "plain line" }]);
  });
});

describe("parseMarkdown", () => {
  it("parses headings, bullets, ordered lists and paragraphs", () => {
    const md =
      "# Verdict\nYou played well.\n\n- point one\n- point two\n\n1. first\n2. second";
    const blocks = parseMarkdown(md);
    expect(blocks[0]).toMatchObject({ t: "h", level: 1 });
    expect(blocks[1]).toMatchObject({ t: "p" });
    expect(blocks[2]).toMatchObject({ t: "ul" });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[3]).toMatchObject({ t: "ol" });
    expect((blocks[3] as { items: unknown[] }).items).toHaveLength(2);
  });
  it("returns an empty list for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(null)).toEqual([]);
  });
});

describe("buildProductionSeries", () => {
  it("returns null with no data", () => {
    expect(buildProductionSeries(undefined, 100)).toBeNull();
    expect(buildProductionSeries({ produced_units: [] }, 100)).toBeNull();
    expect(buildProductionSeries({ produced_units: [] }, 0)).toBeNull();
  });

  it("derives villager series from produced_units when no curve", () => {
    const chart = buildProductionSeries(
      {
        produced_units: [
          { name: "Villager", amount: 1, t_s: 5 },
          { name: "Villager", amount: 1, t_s: 35 },
          { name: "Villager", amount: 1, t_s: 65 },
        ],
      },
      90,
      { stepS: 30 },
    );
    expect(chart).not.toBeNull();
    const vil = chart!.series.find((s) => s.isVillager)!;
    expect(vil.name).toBe("Villagers");
    expect(vil.total).toBe(3);
    // times: 0,30,60,90 → cumulative 0,1,2,3
    expect(chart!.times).toEqual([0, 30, 60, 90]);
    expect(vil.values).toEqual([0, 1, 2, 3]);
  });

  it("prefers explicit villager_curve over derived counts", () => {
    const chart = buildProductionSeries(
      {
        produced_units: [{ name: "Villager", amount: 1, t_s: 5 }],
        villager_curve: [
          { t_s: 0, villagers: 3 },
          { t_s: 30, villagers: 7 },
        ],
      },
      60,
      { stepS: 30 },
    );
    const vil = chart!.series.find((s) => s.isVillager)!;
    // at t=0 →3, t=30 →7, t=60 →7 (last known)
    expect(vil.values).toEqual([3, 7, 7]);
  });

  it("stacks villagers first, then army types by total desc", () => {
    const chart = buildProductionSeries(
      {
        produced_units: [
          { name: "Villager", amount: 1, t_s: 10 },
          { name: "Archer", amount: 2, t_s: 20 },
          { name: "Knight", amount: 5, t_s: 20 },
        ],
      },
      60,
      { stepS: 30 },
    );
    const names = chart!.series.map((s) => s.name);
    expect(names[0]).toBe("Villagers");
    // Knight (5) ranks above Archer (2)
    expect(names.slice(1)).toEqual(["Knight", "Archer"]);
    expect(chart!.series[0].isVillager).toBe(true);
    expect(chart!.series.every((s, i) => i === 0 || !s.isVillager)).toBe(true);
  });

  it("folds beyond-topN army types into Other", () => {
    const produced_units = [
      { name: "A", amount: 10, t_s: 5 },
      { name: "B", amount: 9, t_s: 5 },
      { name: "C", amount: 8, t_s: 5 },
      { name: "D", amount: 7, t_s: 5 },
      { name: "E", amount: 6, t_s: 5 },
      { name: "F", amount: 5, t_s: 5 },
      { name: "G", amount: 4, t_s: 5 },
    ];
    const chart = buildProductionSeries({ produced_units }, 30, {
      stepS: 30,
      topN: 5,
    });
    const names = chart!.series.map((s) => s.name);
    expect(names).toEqual(["A", "B", "C", "D", "E", "Other"]);
    const other = chart!.series.find((s) => s.name === "Other")!;
    expect(other.total).toBe(5 + 4); // F + G
  });

  it("each army series has a distinct color and yMax is the stacked top", () => {
    const chart = buildProductionSeries(
      {
        produced_units: [
          { name: "Villager", amount: 4, t_s: 10 },
          { name: "Archer", amount: 3, t_s: 10 },
        ],
      },
      30,
      { stepS: 30 },
    );
    const colors = chart!.series.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(chart!.yMax).toBe(7); // 4 villagers + 3 archers stacked
  });

  it("extends the timeline to the last event when duration is short", () => {
    const chart = buildProductionSeries(
      { produced_units: [{ name: "Villager", amount: 1, t_s: 200 }] },
      50,
      { stepS: 30 },
    );
    expect(chart!.durationS).toBe(200);
    expect(chart!.times[chart!.times.length - 1]).toBe(200);
  });
});

describe("build-order library helpers", () => {
  const mk = (id: string, family: string): BuildSummary => ({
    id,
    name: id,
    family,
    summary: "s",
  });

  it("labels known families and passes through unknown", () => {
    expect(buildFamilyLabel("scouts")).toBe("Scouts");
    expect(buildFamilyLabel("fast_castle")).toBe("Fast Castle");
    expect(buildFamilyLabel("mystery")).toBe("mystery");
  });

  it("groups builds by family in canonical order", () => {
    const builds = [
      mk("knight-rush", "knights"),
      mk("archers-1-range", "archers"),
      mk("scout-rush", "scouts"),
      mk("korean", "trash"),
    ];
    const groups = groupBuildsByFamily(builds);
    expect(groups.map((g) => g.family)).toEqual([
      "scouts",
      "archers",
      "knights",
      "trash",
    ]);
    expect(groups[0].label).toBe("Scouts");
    expect(groups[1].builds[0].id).toBe("archers-1-range");
  });

  it("sorts unknown families alphabetically after known ones", () => {
    const groups = groupBuildsByFamily([
      mk("z", "zeta"),
      mk("a", "alpha"),
      mk("s", "scouts"),
    ]);
    expect(groups.map((g) => g.family)).toEqual(["scouts", "alpha", "zeta"]);
  });

  it("splits steps into ordered non-empty phase lanes", () => {
    const lanes = buildPhaseLanes([
      { phase: "feudal", task: "Archery Range" },
      { phase: "dark_age", task: "6 to sheep", vils: 6 },
      { phase: "castle", task: "Crossbow" },
    ]);
    expect(lanes.map((l) => l.phase)).toEqual(["dark_age", "feudal", "castle"]);
    expect(lanes[0].label).toBe("Dark Age");
    expect(lanes[0].steps[0].vils).toBe(6);
  });

  it("drops phases with no steps", () => {
    const lanes = buildPhaseLanes([{ phase: "feudal", task: "x" }]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].phase).toBe("feudal");
  });

  it("maps step tasks to icon names (specific wins over general)", () => {
    expect(stepIconName("Archery Range, pump archers, Fletching")).toBe(
      "Archery Range",
    );
    expect(stepIconName("Build a Stable, start Scout Cavalry")).toBe("Stable");
    expect(stepIconName("start Scout Cavalry")).toBe("Light Cavalry");
    expect(stepIconName("transition to cavalry archers")).toBe(
      "Cavalry Archer",
    );
    expect(stepIconName("Stable(s), pump Knights, bloodlines")).toBe("Stable");
    expect(stepIconName("pump Knights, bloodlines")).toBe("Knight");
    expect(stepIconName("research Man-at-Arms immediately")).toBe("Militia");
    expect(stepIconName("Loom, then click up to Feudal at 18 pop")).toBe(
      "Loom",
    );
    expect(stepIconName("6 villagers to sheep")).toBe("Villager");
  });

  it("returns null for an unrecognised task (glyph fallback)", () => {
    expect(stepIconName("Pick a follow-up later")).toBeNull();
    expect(stepIconName("")).toBeNull();
  });
});

describe("economy charts", () => {
  it("niceTicks returns clean linear gridline values from 0 to max", () => {
    expect(niceTicks(130, 5)).toEqual([0, 50, 100]);
    expect(niceTicks(49000, 5)).toEqual([0, 10000, 20000, 30000, 40000]);
    expect(niceTicks(0)).toEqual([0]); // degenerate guard
  });

  it("buildWorkerAllocChart returns villager-count-indexed stacked points + farm line", () => {
    const wa: WorkerAllocation = {
      series: [
        { vils: 3, t_s: 0, alloc: { food: 3 }, active_farms: 0, fishing: 0 },
        {
          vils: 10,
          t_s: 300,
          alloc: { food: 6, wood: 4 },
          active_farms: 6,
          fishing: 0,
        },
      ],
    };
    const c = buildWorkerAllocChart(wa)!;
    expect(c).not.toBeNull();
    expect(c.xMin).toBe(3);
    expect(c.xMax).toBe(10);
    expect(c.resources).toEqual(["food", "wood"]); // present, in canonical order
    expect(c.maxStackTotal).toBe(10); // 6 + 4
    expect(c.points[1].active_farms).toBe(6);
  });

  it("buildResourceBalanceChart returns time-indexed cumulative-spend points", () => {
    const rb: ResourceBalance = {
      series: [
        { vils: 3, t_s: 0, spent: { food: 0 } },
        { vils: 10, t_s: 600, spent: { food: 500, wood: 300 } },
      ],
    };
    const c = buildResourceBalanceChart(rb)!;
    expect(c.xMin).toBe(0);
    expect(c.xMax).toBe(600); // x is time, not villager count
    expect(c.maxStackTotal).toBe(800);
    expect(c.points[1].floating).toEqual({}); // no floating key → empty
  });

  it("buildResourceBalanceChart folds floating into the stacked total (two-tone)", () => {
    const rb: ResourceBalance = {
      series: [
        { vils: 3, t_s: 0, spent: {}, floating: {} },
        { vils: 10, t_s: 600, spent: { wood: 300 }, floating: { wood: 200 } },
      ],
    };
    const c = buildResourceBalanceChart(rb)!;
    expect(c.resources).toEqual(["wood"]);
    expect(c.maxStackTotal).toBe(500); // spent 300 + floating 200 stack
    expect(c.points[1].floating.wood).toBe(200);
  });

  it("lightenHex mixes a color toward white (bright floating shade)", () => {
    expect(lightenHex("#000000", 0.5)).toBe("#808080");
    expect(lightenHex("#3f9e54", 0)).toBe("#3f9e54");
    expect(lightenHex("#ffffff", 0.5)).toBe("#ffffff");
  });

  it("both builders return null without a series (old matches degrade gracefully)", () => {
    expect(buildWorkerAllocChart({})).toBeNull();
    expect(buildWorkerAllocChart(undefined)).toBeNull();
    expect(buildResourceBalanceChart({ series: [] })).toBeNull();
  });
});
