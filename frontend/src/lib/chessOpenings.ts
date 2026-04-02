/**
 * Static chess opening database for the opening trainer.
 * Each opening has a name, ECO code, and moves (SAN notation).
 * The trainer walks through these lines; when the user deviates, they're "out of book."
 */

export interface Opening {
  eco: string;
  name: string;
  moves: string[]; // SAN moves alternating white/black
}

export const OPENINGS: Opening[] = [
  // --- King's Pawn (e4) ---
  {
    eco: "C50",
    name: "Italian Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"],
  },
  {
    eco: "C51",
    name: "Evans Gambit",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4", "Bxb4"],
  },
  {
    eco: "C54",
    name: "Italian Game: Giuoco Piano",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4", "cxd4", "Bb4+"],
  },
  {
    eco: "C60",
    name: "Ruy Lopez",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
  },
  {
    eco: "C65",
    name: "Ruy Lopez: Berlin Defense",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"],
  },
  {
    eco: "C69",
    name: "Ruy Lopez: Exchange Variation",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6"],
  },
  {
    eco: "C78",
    name: "Ruy Lopez: Morphy Defense",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "b5", "Bb3", "d6"],
  },
  {
    eco: "C25",
    name: "Vienna Game",
    moves: ["e4", "e5", "Nc3"],
  },
  {
    eco: "C29",
    name: "Vienna Gambit",
    moves: ["e4", "e5", "Nc3", "Nf6", "f4", "d5", "fxe5", "Nxe4"],
  },
  {
    eco: "C21",
    name: "Danish Gambit",
    moves: ["e4", "e5", "d4", "exd4", "c3", "dxc3", "Bc4"],
  },
  {
    eco: "C33",
    name: "King's Gambit",
    moves: ["e4", "e5", "f4", "exf4"],
  },
  {
    eco: "C44",
    name: "Scotch Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4"],
  },
  {
    eco: "B01",
    name: "Scandinavian Defense",
    moves: ["e4", "d5", "exd5", "Qxd5"],
  },
  {
    eco: "B02",
    name: "Alekhine's Defense",
    moves: ["e4", "Nf6", "e5", "Nd5"],
  },
  {
    eco: "C00",
    name: "French Defense",
    moves: ["e4", "e6", "d4", "d5"],
  },
  {
    eco: "C11",
    name: "French Defense: Classical",
    moves: ["e4", "e6", "d4", "d5", "Nc3", "Nf6"],
  },
  {
    eco: "C02",
    name: "French Defense: Advance",
    moves: ["e4", "e6", "d4", "d5", "e5", "c5", "c3", "Nc6"],
  },
  {
    eco: "B10",
    name: "Caro-Kann Defense",
    moves: ["e4", "c6", "d4", "d5"],
  },
  {
    eco: "B12",
    name: "Caro-Kann: Advance",
    moves: ["e4", "c6", "d4", "d5", "e5", "Bf5"],
  },
  {
    eco: "B13",
    name: "Caro-Kann: Exchange",
    moves: ["e4", "c6", "d4", "d5", "exd5", "cxd5"],
  },
  {
    eco: "B20",
    name: "Sicilian Defense",
    moves: ["e4", "c5"],
  },
  {
    eco: "B22",
    name: "Sicilian: Alapin",
    moves: ["e4", "c5", "c3"],
  },
  {
    eco: "B27",
    name: "Sicilian: Hyper-Accelerated Dragon",
    moves: ["e4", "c5", "Nf3", "g6"],
  },
  {
    eco: "B30",
    name: "Sicilian: Rossolimo",
    moves: ["e4", "c5", "Nf3", "Nc6", "Bb5"],
  },
  {
    eco: "B33",
    name: "Sicilian: Open / Sveshnikov",
    moves: ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5"],
  },
  {
    eco: "B60",
    name: "Sicilian: Dragon",
    moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"],
  },
  {
    eco: "B90",
    name: "Sicilian: Najdorf",
    moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"],
  },
  {
    eco: "C40",
    name: "Petrov's Defense",
    moves: ["e4", "e5", "Nf3", "Nf6"],
  },
  {
    eco: "B06",
    name: "Modern Defense",
    moves: ["e4", "g6", "d4", "Bg7"],
  },
  {
    eco: "B07",
    name: "Pirc Defense",
    moves: ["e4", "d6", "d4", "Nf6", "Nc3", "g6"],
  },

  // --- Queen's Pawn (d4) ---
  {
    eco: "D06",
    name: "Queen's Gambit",
    moves: ["d4", "d5", "c4"],
  },
  {
    eco: "D30",
    name: "Queen's Gambit Declined",
    moves: ["d4", "d5", "c4", "e6"],
  },
  {
    eco: "D20",
    name: "Queen's Gambit Accepted",
    moves: ["d4", "d5", "c4", "dxc4"],
  },
  {
    eco: "D35",
    name: "Queen's Gambit Declined: Exchange",
    moves: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5"],
  },
  {
    eco: "D51",
    name: "Queen's Gambit Declined: Cambridge Springs",
    moves: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Nbd7", "Nf3", "c6", "e3", "Qa5"],
  },
  {
    eco: "D10",
    name: "Slav Defense",
    moves: ["d4", "d5", "c4", "c6"],
  },
  {
    eco: "D43",
    name: "Semi-Slav Defense",
    moves: ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6"],
  },
  {
    eco: "A45",
    name: "Trompowsky Attack",
    moves: ["d4", "Nf6", "Bg5"],
  },
  {
    eco: "D00",
    name: "London System",
    moves: ["d4", "d5", "Bf4"],
  },
  {
    eco: "D01",
    name: "Veresov Attack",
    moves: ["d4", "d5", "Nc3", "Nf6", "Bg5"],
  },
  {
    eco: "E60",
    name: "King's Indian Defense",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"],
  },
  {
    eco: "E62",
    name: "King's Indian: Fianchetto",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "Nf3", "d6", "g3", "O-O", "Bg2"],
  },
  {
    eco: "E70",
    name: "King's Indian: Classical",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6", "Nf3", "O-O", "Be2", "e5"],
  },
  {
    eco: "E20",
    name: "Nimzo-Indian Defense",
    moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"],
  },
  {
    eco: "E15",
    name: "Queen's Indian Defense",
    moves: ["d4", "Nf6", "c4", "e6", "Nf3", "b6"],
  },
  {
    eco: "A56",
    name: "Benoni Defense",
    moves: ["d4", "Nf6", "c4", "c5", "d5", "e6"],
  },
  {
    eco: "E00",
    name: "Catalan Opening",
    moves: ["d4", "Nf6", "c4", "e6", "g3", "d5", "Bg2"],
  },
  {
    eco: "A80",
    name: "Dutch Defense",
    moves: ["d4", "f5"],
  },
  {
    eco: "D70",
    name: "Grünfeld Defense",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "d5"],
  },
  {
    eco: "A46",
    name: "Torre Attack",
    moves: ["d4", "Nf6", "Nf3", "e6", "Bg5"],
  },

  // --- Flank Openings ---
  {
    eco: "A04",
    name: "Réti Opening",
    moves: ["Nf3", "d5", "c4"],
  },
  {
    eco: "A10",
    name: "English Opening",
    moves: ["c4"],
  },
  {
    eco: "A20",
    name: "English: Reversed Sicilian",
    moves: ["c4", "e5"],
  },
  {
    eco: "A00",
    name: "Bird's Opening",
    moves: ["f4"],
  },
];

/**
 * Given a sequence of SAN moves, find all openings that match as a prefix.
 * Returns the longest matching opening(s) and any "next moves" from book lines.
 */
export function lookupPosition(moves: string[]): {
  opening: { eco: string; name: string } | null;
  bookMoves: string[];
} {
  let bestMatch: Opening | null = null;
  const nextMoves = new Set<string>();

  for (const op of OPENINGS) {
    // Check if current moves are a prefix of this opening
    const isPrefix = moves.every((m, i) => i < op.moves.length && op.moves[i] === m);
    if (!isPrefix) continue;

    // This opening matches the current position
    if (!bestMatch || op.moves.length <= moves.length) {
      // Exact or longest match
      if (moves.length <= op.moves.length) {
        if (!bestMatch || (op.moves.length >= bestMatch.moves.length && op.moves.length <= moves.length + 1)) {
          bestMatch = op;
        }
        // If the opening has the current position, offer the next move
        if (moves.length < op.moves.length) {
          nextMoves.add(op.moves[moves.length]);
        }
      }
    } else if (op.moves.length > moves.length) {
      nextMoves.add(op.moves[moves.length]);
      // Update best match if this one matches more of the played moves
      if (!bestMatch || op.moves.length > bestMatch.moves.length) {
        // Only if it's still a prefix match with moves played so far
      }
    }
  }

  // Find the most specific opening name (longest match ≤ current moves length)
  let longestMatch: Opening | null = null;
  for (const op of OPENINGS) {
    if (op.moves.length > moves.length) continue;
    const matches = op.moves.every((m, i) => moves[i] === m);
    if (matches && (!longestMatch || op.moves.length > longestMatch.moves.length)) {
      longestMatch = op;
    }
  }

  return {
    opening: longestMatch ? { eco: longestMatch.eco, name: longestMatch.name } : null,
    bookMoves: Array.from(nextMoves),
  };
}
