import { describe, expect, test } from "vitest";
import {
  CHESS_FACTORY_BUILD_TICKS,
  CHESS_MOVE_COOLDOWN,
  CHESS_MOVE_RANGE,
  CHESS_START_FORMATION,
} from "../src/core/chess/ChessConstants";
import {
  bestKnightLanding,
  ChessBoardView,
  ChessCell,
  ChessPieceRef,
  findFactoryDepositCell,
  isVariableKnightOffset,
  knightLeapOffsets,
  knightLPath,
  legalMovesForPiece,
  truncatePathAt,
  workshopHasOpenNeighbor,
} from "../src/core/chess/ChessMoves";
import { UnitType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";

/** Flat all-land board for chess cell math (width/height in pixels). */
function makeBoard(
  widthCells: number,
  heightCells: number,
  occupants: Array<{ cx: number; cy: number; ownerId: string; type: UnitType }> = [],
): ChessBoardView {
  const cell = 32;
  const width = widthCells * cell;
  const height = heightCells * cell;
  const units: ChessPieceRef[] = occupants.map((o, i) => ({
    isActive: () => true,
    type: () => o.type,
    tile: () => (o.cy * cell + 16) * width + (o.cx * cell + 16),
    owner: () => ({ id: () => o.ownerId }),
  }));

  return {
    width: () => width,
    height: () => height,
    isValidCoord: (x, y) => x >= 0 && y >= 0 && x < width && y < height,
    x: (tile: TileRef) => tile % width,
    y: (tile: TileRef) => Math.floor(tile / width),
    ref: (x, y) => y * width + x,
    isLand: () => true,
    isImpassable: () => false,
    units: () => units,
  };
}

function pieceAt(
  board: ChessBoardView,
  type: UnitType,
  cx: number,
  cy: number,
  ownerId = "p1",
): ChessPieceRef {
  const tile = board.ref(cx * 32 + 16, cy * 32 + 16);
  return {
    isActive: () => true,
    type: () => type,
    tile: () => tile,
    owner: () => ({ id: () => ownerId }),
  };
}

describe("ChessConstants cooldowns", () => {
  test("match seconds at 10 ticks/s", () => {
    expect(CHESS_MOVE_COOLDOWN[UnitType.SAMLauncher]).toBe(30);
    expect(CHESS_MOVE_COOLDOWN[UnitType.DefensePost]).toBe(50);
    expect(CHESS_MOVE_COOLDOWN[UnitType.MissileSilo]).toBe(50);
    expect(CHESS_MOVE_COOLDOWN[UnitType.Port]).toBe(80);
    expect(CHESS_MOVE_COOLDOWN[UnitType.Factory]).toBe(100);
    expect(CHESS_MOVE_COOLDOWN[UnitType.City]).toBe(100);
    expect(CHESS_MOVE_COOLDOWN[UnitType.Workshop]).toBe(20);
  });
});

describe("CHESS_FACTORY_BUILD_TICKS", () => {
  test("match product build times at 10 ticks/s", () => {
    expect(CHESS_FACTORY_BUILD_TICKS[UnitType.Factory]).toBe(600);
    expect(CHESS_FACTORY_BUILD_TICKS[UnitType.Port]).toBe(450);
    expect(CHESS_FACTORY_BUILD_TICKS[UnitType.MissileSilo]).toBe(300);
    expect(CHESS_FACTORY_BUILD_TICKS[UnitType.DefensePost]).toBe(300);
    expect(CHESS_FACTORY_BUILD_TICKS[UnitType.SAMLauncher]).toBe(150);
  });
});

describe("CHESS_START_FORMATION", () => {
  test("matches chess2.md 6×6 layout", () => {
    expect(CHESS_START_FORMATION).toHaveLength(6);
    for (const row of CHESS_START_FORMATION) {
      expect(row).toHaveLength(6);
    }
    // Outer pawn rows
    expect(CHESS_START_FORMATION[0].every((c) => c === UnitType.SAMLauncher)).toBe(
      true,
    );
    expect(CHESS_START_FORMATION[5].every((c) => c === UnitType.SAMLauncher)).toBe(
      true,
    );
    // Inner pattern row 1: P R H B R P
    expect(CHESS_START_FORMATION[1]).toEqual([
      UnitType.SAMLauncher,
      UnitType.Port,
      UnitType.MissileSilo,
      UnitType.DefensePost,
      UnitType.Port,
      UnitType.SAMLauncher,
    ]);
    // Center: K F / F Q
    expect(CHESS_START_FORMATION[2][2]).toBe(UnitType.City);
    expect(CHESS_START_FORMATION[2][3]).toBe(UnitType.Workshop);
    expect(CHESS_START_FORMATION[3][2]).toBe(UnitType.Workshop);
    expect(CHESS_START_FORMATION[3][3]).toBe(UnitType.Factory);

    let pieces = 0;
    let blanks = 0;
    for (const row of CHESS_START_FORMATION) {
      for (const cell of row) {
        if (cell === null) blanks++;
        else pieces++;
      }
    }
    expect(blanks).toBe(0);
    expect(pieces).toBe(36);
  });
});

describe("variable knight L offsets", () => {
  test("includes classic and extended L shapes", () => {
    expect(isVariableKnightOffset(1, 2)).toBe(true);
    expect(isVariableKnightOffset(2, 4)).toBe(true);
    expect(isVariableKnightOffset(1, 5)).toBe(true);
  });

  test("rejects diagonal, ortho, and too-long leaps", () => {
    expect(isVariableKnightOffset(3, 3)).toBe(false);
    expect(isVariableKnightOffset(0, 5)).toBe(false);
    expect(isVariableKnightOffset(1, 6)).toBe(false); // manhattan 7
    expect(isVariableKnightOffset(2, 5)).toBe(false); // manhattan 7
  });

  test("knightLeapOffsets only yields valid L within max manhattan", () => {
    for (const [dx, dy] of knightLeapOffsets()) {
      expect(isVariableKnightOffset(dx, dy)).toBe(true);
      expect(Math.abs(dx) + Math.abs(dy)).toBeLessThanOrEqual(
        CHESS_MOVE_RANGE.knightMaxManhattan,
      );
    }
    const set = new Set(knightLeapOffsets().map(([a, b]) => `${a},${b}`));
    expect(set.has("1,2")).toBe(true);
    expect(set.has("2,4")).toBe(true);
    expect(set.has("3,3")).toBe(false);
    expect(set.has("0,5")).toBe(false);
  });
});

describe("bestKnightLanding aim-snap", () => {
  const from: ChessCell = { cx: 10, cy: 10 };
  const legal: ChessCell[] = [
    { cx: 12, cy: 11 }, // (2,1) right-ish
    { cx: 11, cy: 14 }, // (1,4) down-ish
    { cx: 6, cy: 11 }, // (-4,1) left-ish
  ];

  test("prefers landing aligned with cursor to the right", () => {
    const snap = bestKnightLanding(from, legal, { cx: 20, cy: 10 });
    expect(snap).toEqual({ cx: 12, cy: 11 });
  });

  test("prefers landing aligned with cursor downward", () => {
    const snap = bestKnightLanding(from, legal, { cx: 10, cy: 20 });
    expect(snap).toEqual({ cx: 11, cy: 14 });
  });
});

describe("truncatePathAt", () => {
  const path: ChessCell[] = [
    { cx: 1, cy: 0 },
    { cx: 2, cy: 0 },
    { cx: 3, cy: 0 },
  ];

  test("truncates through matching hover cell", () => {
    expect(truncatePathAt(path, { cx: 2, cy: 0 })).toEqual([
      { cx: 1, cy: 0 },
      { cx: 2, cy: 0 },
    ]);
  });

  test("returns full path when hover is last cell", () => {
    expect(truncatePathAt(path, { cx: 3, cy: 0 })).toEqual(path);
  });

  test("returns path unchanged when hover is not on path", () => {
    expect(truncatePathAt(path, { cx: 9, cy: 9 })).toEqual(path);
  });
});

describe("knightLPath", () => {
  test("horizontal-first elbow", () => {
    const path = knightLPath(
      { cx: 0, cy: 0 },
      { cx: 2, cy: 1 },
      "horizontal",
    );
    expect(path).toEqual([
      { cx: 1, cy: 0 },
      { cx: 2, cy: 0 },
    ]);
  });

  test("vertical-first elbow", () => {
    const path = knightLPath({ cx: 0, cy: 0 }, { cx: 2, cy: 1 }, "vertical");
    expect(path).toEqual([
      { cx: 0, cy: 1 },
      { cx: 1, cy: 1 },
    ]);
  });
});

describe("legalMovesForPiece ranges", () => {
  const board = makeBoard(40, 40);

  test("pawn is orthogonal only up to range 3", () => {
    const pawn = pieceAt(board, UnitType.SAMLauncher, 20, 20);
    const moves = legalMovesForPiece(board, pawn);
    expect(moves.length).toBe(CHESS_MOVE_RANGE.pawn * 4);
    for (const m of moves) {
      const dx = Math.abs(m.cx - 20);
      const dy = Math.abs(m.cy - 20);
      expect(dx === 0 || dy === 0).toBe(true);
      expect(dx + dy).toBeGreaterThan(0);
      expect(dx + dy).toBeLessThanOrEqual(CHESS_MOVE_RANGE.pawn);
    }
    expect(moves.some((m) => m.cx === 21 && m.cy === 21)).toBe(false);
  });

  test("king Chebyshev range is 3", () => {
    const king = pieceAt(board, UnitType.City, 20, 20);
    const moves = legalMovesForPiece(board, king);
    expect(moves.length).toBe(7 * 7 - 1);
  });

  test("rook slides at most 16", () => {
    const rook = pieceAt(board, UnitType.Port, 20, 20);
    const moves = legalMovesForPiece(board, rook);
    const right = moves.filter((m) => m.cy === 20 && m.cx > 20);
    expect(Math.max(...right.map((m) => m.cx - 20))).toBe(
      CHESS_MOVE_RANGE.rook,
    );
  });

  test("bishop slides at most 12", () => {
    const bishop = pieceAt(board, UnitType.DefensePost, 20, 20);
    const moves = legalMovesForPiece(board, bishop);
    const diag = moves.filter((m) => m.cx - 20 === m.cy - 20 && m.cx > 20);
    expect(Math.max(...diag.map((m) => m.cx - 20))).toBe(
      CHESS_MOVE_RANGE.bishop,
    );
  });

  test("queen slides at most 16", () => {
    const queen = pieceAt(board, UnitType.Factory, 20, 20);
    const moves = legalMovesForPiece(board, queen);
    const right = moves.filter((m) => m.cy === 20 && m.cx > 20);
    expect(Math.max(...right.map((m) => m.cx - 20))).toBe(
      CHESS_MOVE_RANGE.queen,
    );
  });

  test("knight includes extended L landings", () => {
    const knight = pieceAt(board, UnitType.MissileSilo, 20, 20);
    const moves = legalMovesForPiece(board, knight);
    const set = new Set(moves.map((m) => `${m.cx},${m.cy}`));
    expect(set.has("21,22")).toBe(true); // (1,2)
    expect(set.has("22,24")).toBe(true); // (2,4)
    expect(set.has("23,23")).toBe(false); // (3,3) diagonal
  });

  test("workshop moves one step in any direction", () => {
    const workshop = pieceAt(board, UnitType.Workshop, 20, 20);
    const moves = legalMovesForPiece(board, workshop);
    expect(moves.length).toBe(8);
    for (const m of moves) {
      const dx = Math.abs(m.cx - 20);
      const dy = Math.abs(m.cy - 20);
      expect(Math.max(dx, dy)).toBe(1);
    }
  });
});

describe("factory deposit hold semantics", () => {
  test("no open neighbor means hold (helper reports null, not a cancel signal)", () => {
    const occupants = [{ cx: 5, cy: 5, ownerId: "p1", type: UnitType.Workshop }];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        occupants.push({
          cx: 5 + dx,
          cy: 5 + dy,
          ownerId: "p1",
          type: UnitType.SAMLauncher,
        });
      }
    }
    const board = makeBoard(10, 10, occupants);
    // Execution keeps ticking until this becomes non-null.
    expect(findFactoryDepositCell(board, 5, 5)).toBeNull();
  });
});

describe("factory deposit helpers", () => {
  test("findFactoryDepositCell picks nearest empty neighbor (cy, cx)", () => {
    const board = makeBoard(10, 10, [
      { cx: 5, cy: 5, ownerId: "p1", type: UnitType.Workshop },
      { cx: 4, cy: 4, ownerId: "p1", type: UnitType.SAMLauncher },
      { cx: 5, cy: 4, ownerId: "p1", type: UnitType.SAMLauncher },
      { cx: 6, cy: 4, ownerId: "p1", type: UnitType.SAMLauncher },
      { cx: 4, cy: 5, ownerId: "p1", type: UnitType.SAMLauncher },
    ]);
    // Open: (6,5), (4,6), (5,6), (6,6) — lowest cy then cx → (6,5)
    expect(findFactoryDepositCell(board, 5, 5)).toEqual({ cx: 6, cy: 5 });
    expect(workshopHasOpenNeighbor(board, 5, 5)).toBe(true);
  });

  test("returns null when all neighbors occupied", () => {
    const occupants = [{ cx: 5, cy: 5, ownerId: "p1", type: UnitType.Workshop }];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        occupants.push({
          cx: 5 + dx,
          cy: 5 + dy,
          ownerId: "p1",
          type: UnitType.SAMLauncher,
        });
      }
    }
    const board = makeBoard(10, 10, occupants);
    expect(findFactoryDepositCell(board, 5, 5)).toBeNull();
    expect(workshopHasOpenNeighbor(board, 5, 5)).toBe(false);
  });
});
