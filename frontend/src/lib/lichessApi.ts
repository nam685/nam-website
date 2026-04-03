/**
 * Lichess API helpers: ND-JSON stream parsing, Board API, Opening Explorer.
 */

import { API } from "./api";

/* -- ND-JSON Stream Parser ---------------------------------------- */

export async function parseNdJsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.trim()) {
        onEvent(JSON.parse(line));
      }
    }
  }
  // Flush remaining buffer
  if (buffer.trim()) {
    onEvent(JSON.parse(buffer));
  }
}

/* -- Board API ---------------------------------------------------- */

const LICHESS = "https://lichess.org";

export function lichessHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/x-ndjson" };
}

/** Stream account events (gameStart, gameFinish, challenge) */
export function streamEvents(
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${LICHESS}/api/stream/event`, {
    headers: lichessHeaders(token),
    signal,
  });
}

/** Stream a board game */
export function streamBoardGame(
  token: string,
  gameId: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/stream/${gameId}`, {
    headers: lichessHeaders(token),
    signal,
  });
}

/** Send a move (UCI notation, e.g. "e2e4") */
export function sendMove(
  token: string,
  gameId: string,
  uci: string,
): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/move/${uci}`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Resign a game */
export function resignGame(token: string, gameId: string): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/resign`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Offer or accept a draw */
export function offerDraw(
  token: string,
  gameId: string,
  accept: "yes" | "no",
): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/draw/${accept}`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Abort a game (only if < 2 moves played) */
export function abortGame(token: string, gameId: string): Promise<Response> {
  return fetch(`${LICHESS}/api/board/game/${gameId}/abort`, {
    method: "POST",
    headers: lichessHeaders(token),
  });
}

/** Challenge a specific player */
export function challengePlayer(
  token: string,
  username: string,
  opts: {
    clock?: { limit: number; increment: number };
    color?: "white" | "black" | "random";
    rated?: boolean;
  },
): Promise<Response> {
  const body: Record<string, string> = {};
  if (opts.clock) {
    body["clock.limit"] = String(opts.clock.limit);
    body["clock.increment"] = String(opts.clock.increment);
  }
  if (opts.color) body.color = opts.color;
  if (opts.rated !== undefined) body.rated = String(opts.rated);

  return fetch(`${LICHESS}/api/challenge/${username}`, {
    method: "POST",
    headers: {
      ...lichessHeaders(token),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}

/** Create an open challenge (returns a URL others can join) */
export function createOpenChallenge(
  token: string,
  opts: {
    clock?: { limit: number; increment: number };
    rated?: boolean;
  },
): Promise<Response> {
  const body: Record<string, string> = {};
  if (opts.clock) {
    body["clock.limit"] = String(opts.clock.limit);
    body["clock.increment"] = String(opts.clock.increment);
  }
  if (opts.rated !== undefined) body.rated = String(opts.rated);

  return fetch(`${LICHESS}/api/challenge/open`, {
    method: "POST",
    headers: {
      ...lichessHeaders(token),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
}

/** Seek a random opponent */
export function seekOpponent(
  token: string,
  opts: { time: number; increment: number; rated?: boolean },
  signal?: AbortSignal,
): Promise<Response> {
  const body: Record<string, string> = {
    time: String(opts.time / 60), // Lichess expects minutes
    increment: String(opts.increment),
  };
  if (opts.rated !== undefined) body.rated = String(opts.rated);

  return fetch(`${LICHESS}/api/board/seek`, {
    method: "POST",
    headers: {
      ...lichessHeaders(token),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    signal,
  });
}

/* -- Opening Explorer --------------------------------------------- */

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating: number;
}

export interface ExplorerResponse {
  opening: { eco: string; name: string } | null;
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  topGames?: {
    id: string;
    white: { name: string; rating: number };
    black: { name: string; rating: number };
  }[];
}

export type ExplorerDb = "masters" | "lichess";

export function buildExplorerUrl(
  db: ExplorerDb,
  fen: string,
  opts?: { ratings?: number[]; speeds?: string[] },
): string {
  // Proxy through our backend — Lichess now requires auth on explorer.lichess.org
  const base = `${API}/api/lichess/explorer/${db}/`;
  const params = new URLSearchParams({ fen });
  if (opts?.ratings?.length) params.set("ratings", opts.ratings.join(","));
  if (opts?.speeds?.length) params.set("speeds", opts.speeds.join(","));
  return `${base}?${params}`;
}

/** Session cache to avoid re-fetching the same position */
const explorerCache = new Map<string, ExplorerResponse>();

export async function fetchExplorer(
  db: ExplorerDb,
  fen: string,
  opts?: { ratings?: number[]; speeds?: string[] },
): Promise<ExplorerResponse | null> {
  const url = buildExplorerUrl(db, fen, opts);
  const cached = explorerCache.get(url);
  if (cached) return cached;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data: ExplorerResponse = await resp.json();
    explorerCache.set(url, data);
    return data;
  } catch {
    return null;
  }
}
