import { describe, it, expect, vi } from "vitest";
import { parseNdJsonStream, buildExplorerUrl } from "../lichessApi";

describe("parseNdJsonStream", () => {
  it("parses newline-delimited JSON events", async () => {
    const events: unknown[] = [];
    const lines =
      '{"type":"gameFull","id":"abc"}\n{"type":"gameState","moves":"e2e4"}\n';
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(lines));
        controller.close();
      },
    });

    await parseNdJsonStream(stream, (event) => events.push(event));

    expect(events).toEqual([
      { type: "gameFull", id: "abc" },
      { type: "gameState", moves: "e2e4" },
    ]);
  });

  it("handles chunked data across read boundaries", async () => {
    const events: unknown[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"game'));
        controller.enqueue(encoder.encode('Full"}\n'));
        controller.close();
      },
    });

    await parseNdJsonStream(stream, (event) => events.push(event));

    expect(events).toEqual([{ type: "gameFull" }]);
  });

  it("skips empty lines (keepalive)", async () => {
    const events: unknown[] = [];
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('\n\n{"type":"gameState"}\n\n'));
        controller.close();
      },
    });

    await parseNdJsonStream(stream, (event) => events.push(event));

    expect(events).toEqual([{ type: "gameState" }]);
  });
});

describe("buildExplorerUrl", () => {
  it("builds masters URL", () => {
    const url = buildExplorerUrl(
      "masters",
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    );
    expect(url).toContain("explorer.lichess.org/masters");
    expect(url).toContain("fen=");
  });

  it("builds lichess URL with rating filter", () => {
    const url = buildExplorerUrl(
      "lichess",
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      { ratings: [2000, 2200] },
    );
    expect(url).toContain("explorer.lichess.org/lichess");
    expect(url).toContain("ratings=2000%2C2200");
  });
});
