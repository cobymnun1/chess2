import { UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  CHESS_CELL,
  CHESS_MOVE_RANGE,
  ChessPieceUnitType,
  isChessPieceType,
} from "./ChessConstants";

/** Minimal piece surface shared by Unit and UnitView. */
export interface ChessPieceRef {
  isActive(): boolean;
  type(): UnitType;
  tile(): TileRef;
  owner(): { id(): string };
}

/** Minimal map surface shared by Game and GameView for chess helpers. */
export interface ChessBoardView {
  x(tile: TileRef): number;
  y(tile: TileRef): number;
  ref(x: number, y: number): TileRef;
  width(): number;
  height(): number;
  isValidCoord(x: number, y: number): boolean;
  isLand(tile: TileRef): boolean;
  isImpassable(tile: TileRef): boolean;
  units(...types: UnitType[]): ChessPieceRef[];
}

export type ChessCell = { cx: number; cy: number };

export type KnightPreferAxis = "horizontal" | "vertical";

export function tileToCell(mg: ChessBoardView, tile: TileRef): ChessCell {
  return {
    cx: Math.floor(mg.x(tile) / CHESS_CELL),
    cy: Math.floor(mg.y(tile) / CHESS_CELL),
  };
}

export function cellCenterTile(
  mg: ChessBoardView,
  cx: number,
  cy: number,
): TileRef {
  const x = Math.min(
    mg.width() - 1,
    Math.max(0, cx * CHESS_CELL + Math.floor(CHESS_CELL / 2)),
  );
  const y = Math.min(
    mg.height() - 1,
    Math.max(0, cy * CHESS_CELL + Math.floor(CHESS_CELL / 2)),
  );
  return mg.ref(x, y);
}

export function cellInBounds(
  mg: ChessBoardView,
  cx: number,
  cy: number,
): boolean {
  const maxCx = Math.floor((mg.width() - 1) / CHESS_CELL);
  const maxCy = Math.floor((mg.height() - 1) / CHESS_CELL);
  return cx >= 0 && cy >= 0 && cx <= maxCx && cy <= maxCy;
}

/** All land tile refs inside a chess cell. */
export function tilesInCell(
  mg: ChessBoardView,
  cx: number,
  cy: number,
): TileRef[] {
  const tiles: TileRef[] = [];
  const x0 = cx * CHESS_CELL;
  const y0 = cy * CHESS_CELL;
  for (let dy = 0; dy < CHESS_CELL; dy++) {
    for (let dx = 0; dx < CHESS_CELL; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (!mg.isValidCoord(x, y)) continue;
      const t = mg.ref(x, y);
      if (mg.isLand(t) && !mg.isImpassable(t)) {
        tiles.push(t);
      }
    }
  }
  return tiles;
}

function unitOnCell(
  mg: ChessBoardView,
  cx: number,
  cy: number,
): ChessPieceRef | null {
  for (const u of mg.units()) {
    if (!u.isActive() || !isChessPieceType(u.type())) continue;
    const c = tileToCell(mg, u.tile());
    if (c.cx === cx && c.cy === cy) {
      return u;
    }
  }
  return null;
}

export function chessPieceOnCell(
  mg: ChessBoardView,
  cx: number,
  cy: number,
): ChessPieceRef | null {
  return unitOnCell(mg, cx, cy);
}

/** Eight neighboring chess cells (Chebyshev ring of 1), unsorted. */
export function adjacentChessCells(cx: number, cy: number): ChessCell[] {
  const out: ChessCell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      out.push({ cx: cx + dx, cy: cy + dy });
    }
  }
  return out;
}

/** True if the cell is in-bounds and has no chess piece. */
export function isChessCellOpen(
  mg: ChessBoardView,
  cx: number,
  cy: number,
): boolean {
  if (!cellInBounds(mg, cx, cy)) return false;
  if (tilesInCell(mg, cx, cy).length === 0) return false;
  return unitOnCell(mg, cx, cy) === null;
}

/**
 * Closest empty adjacent cell for Workshop deposits.
 * All neighbors are Chebyshev-1; tie-break by (cy, cx) ascending.
 */
export function findFactoryDepositCell(
  mg: ChessBoardView,
  fromCx: number,
  fromCy: number,
): ChessCell | null {
  const open = adjacentChessCells(fromCx, fromCy)
    .filter((c) => isChessCellOpen(mg, c.cx, c.cy))
    .sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return open[0] ?? null;
}

/** True if Workshop has at least one open neighbor to start/finish a build. */
export function workshopHasOpenNeighbor(
  mg: ChessBoardView,
  cx: number,
  cy: number,
): boolean {
  return findFactoryDepositCell(mg, cx, cy) !== null;
}

function clearPath(
  mg: ChessBoardView,
  from: ChessCell,
  to: ChessCell,
  stepX: number,
  stepY: number,
): boolean {
  if (stepX === 0 && stepY === 0) return false;
  const absDx = Math.abs(to.cx - from.cx);
  const absDy = Math.abs(to.cy - from.cy);
  const steps = Math.max(absDx, absDy);
  if (steps <= 0) return false;
  // Guard: step must divide the distance (true slides only).
  if (absDx !== 0 && absDx % Math.abs(stepX) !== 0) return false;
  if (absDy !== 0 && absDy % Math.abs(stepY) !== 0) return false;

  let x = from.cx + stepX;
  let y = from.cy + stepY;
  for (let i = 1; i < steps; i++) {
    if (unitOnCell(mg, x, y)) return false;
    x += stepX;
    y += stepY;
  }
  return true;
}

function canLandOn(
  mg: ChessBoardView,
  ownerId: string,
  cx: number,
  cy: number,
): { ok: boolean; capture: ChessPieceRef | null } {
  if (!cellInBounds(mg, cx, cy)) return { ok: false, capture: null };
  const destTiles = tilesInCell(mg, cx, cy);
  if (destTiles.length === 0) return { ok: false, capture: null };
  const occupant = unitOnCell(mg, cx, cy);
  if (!occupant) return { ok: true, capture: null };
  if (occupant.owner().id() === ownerId) return { ok: false, capture: null };
  return { ok: true, capture: occupant };
}

function pushMove(
  mg: ChessBoardView,
  ownerId: string,
  moves: ChessCell[],
  cx: number,
  cy: number,
) {
  const land = canLandOn(mg, ownerId, cx, cy);
  if (land.ok) moves.push({ cx, cy });
}

function slideMoves(
  mg: ChessBoardView,
  ownerId: string,
  from: ChessCell,
  dirs: Array<[number, number]>,
  maxSteps: number,
): ChessCell[] {
  const moves: ChessCell[] = [];
  for (const [dx, dy] of dirs) {
    let cx = from.cx + dx;
    let cy = from.cy + dy;
    let steps = 0;
    while (cellInBounds(mg, cx, cy) && steps < maxSteps) {
      const land = canLandOn(mg, ownerId, cx, cy);
      if (!land.ok) break;
      moves.push({ cx, cy });
      if (land.capture) break;
      cx += dx;
      cy += dy;
      steps++;
    }
  }
  return moves;
}

function chebyshevMoves(
  mg: ChessBoardView,
  ownerId: string,
  from: ChessCell,
  range: number,
): ChessCell[] {
  const moves: ChessCell[] = [];
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      if (dx === 0 && dy === 0) continue;
      pushMove(mg, ownerId, moves, from.cx + dx, from.cy + dy);
    }
  }
  return moves;
}

/** True if (dx,dy) is a variable L with manhattan ≤ maxManhattan. */
export function isVariableKnightOffset(
  dx: number,
  dy: number,
  maxManhattan: number = CHESS_MOVE_RANGE.knightMaxManhattan,
): boolean {
  if (dx === 0 || dy === 0) return false;
  if (Math.abs(dx) === Math.abs(dy)) return false;
  return Math.abs(dx) + Math.abs(dy) <= maxManhattan;
}

/** All variable-L leap offsets up to max manhattan. */
export function knightLeapOffsets(
  maxManhattan: number = CHESS_MOVE_RANGE.knightMaxManhattan,
): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  for (let dx = -maxManhattan; dx <= maxManhattan; dx++) {
    for (let dy = -maxManhattan; dy <= maxManhattan; dy++) {
      if (isVariableKnightOffset(dx, dy, maxManhattan)) {
        offsets.push([dx, dy]);
      }
    }
  }
  return offsets;
}

export function legalKnightMoves(
  mg: ChessBoardView,
  ownerId: string,
  from: ChessCell,
): ChessCell[] {
  const moves: ChessCell[] = [];
  for (const [dx, dy] of knightLeapOffsets()) {
    pushMove(mg, ownerId, moves, from.cx + dx, from.cy + dy);
  }
  return moves;
}

/**
 * Intermediate cells along an L elbow from → to (exclusive of endpoints).
 * preferAxis chooses H-then-V vs V-then-H when both legs are nonzero.
 */
export function knightLPath(
  from: ChessCell,
  to: ChessCell,
  preferAxis: KnightPreferAxis,
): ChessCell[] {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (!isVariableKnightOffset(dx, dy)) return [];

  const cells: ChessCell[] = [];
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (preferAxis === "horizontal") {
    for (let i = 1; i <= absDx; i++) {
      cells.push({ cx: from.cx + sx * i, cy: from.cy });
    }
    for (let i = 1; i < absDy; i++) {
      cells.push({ cx: to.cx, cy: from.cy + sy * i });
    }
  } else {
    for (let i = 1; i <= absDy; i++) {
      cells.push({ cx: from.cx, cy: from.cy + sy * i });
    }
    for (let i = 1; i < absDx; i++) {
      cells.push({ cx: from.cx + sx * i, cy: to.cy });
    }
  }
  return cells;
}

/** Prefer first leg matching the stronger cursor axis from the piece. */
export function knightPreferAxisFromCursor(
  from: ChessCell,
  cursor: ChessCell,
): KnightPreferAxis {
  const adx = Math.abs(cursor.cx - from.cx);
  const ady = Math.abs(cursor.cy - from.cy);
  return adx >= ady ? "horizontal" : "vertical";
}

/**
 * Pick the best legal L landing toward the cursor.
 * Prefer smallest angular error piece→cursor vs piece→landing; then
 * closer manhattan to cursor; then shorter L.
 */
export function bestKnightLanding(
  from: ChessCell,
  legal: ChessCell[],
  cursor: ChessCell,
): ChessCell | null {
  if (legal.length === 0) return null;

  const cdx = cursor.cx - from.cx;
  const cdy = cursor.cy - from.cy;
  const cLen = Math.hypot(cdx, cdy);

  let best: ChessCell | null = null;
  let bestAngle = Infinity;
  let bestManhattanToCursor = Infinity;
  let bestLLen = Infinity;

  for (const land of legal) {
    const ldx = land.cx - from.cx;
    const ldy = land.cy - from.cy;
    const lLen = Math.hypot(ldx, ldy);
    if (lLen === 0) continue;

    let angle = 0;
    if (cLen > 0) {
      const dot = (cdx * ldx + cdy * ldy) / (cLen * lLen);
      const clamped = Math.max(-1, Math.min(1, dot));
      angle = Math.acos(clamped);
    }

    const manToCursor =
      Math.abs(land.cx - cursor.cx) + Math.abs(land.cy - cursor.cy);
    const lManhattan = Math.abs(ldx) + Math.abs(ldy);

    const better =
      angle < bestAngle - 1e-9 ||
      (Math.abs(angle - bestAngle) < 1e-9 &&
        manToCursor < bestManhattanToCursor) ||
      (Math.abs(angle - bestAngle) < 1e-9 &&
        manToCursor === bestManhattanToCursor &&
        lManhattan < bestLLen);

    if (better) {
      best = land;
      bestAngle = angle;
      bestManhattanToCursor = manToCursor;
      bestLLen = lManhattan;
    }
  }

  return best;
}

/**
 * Legal destination cells for a chess piece.
 */
export function legalMovesForPiece(
  mg: ChessBoardView,
  unit: ChessPieceRef,
): ChessCell[] {
  if (!isChessPieceType(unit.type())) return [];
  const from = tileToCell(mg, unit.tile());
  const ownerId = unit.owner().id();
  const type = unit.type() as ChessPieceUnitType;

  switch (type) {
    case UnitType.SAMLauncher: // Pawn — orthogonal only, up to range
      return slideMoves(
        mg,
        ownerId,
        from,
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ],
        CHESS_MOVE_RANGE.pawn,
      );
    case UnitType.City: // King — any direction, Chebyshev ≤ 3
      return chebyshevMoves(mg, ownerId, from, CHESS_MOVE_RANGE.king);
    case UnitType.Workshop: // Factory — one step any direction
      return chebyshevMoves(mg, ownerId, from, CHESS_MOVE_RANGE.workshop);
    case UnitType.Port: // Rook
      return slideMoves(
        mg,
        ownerId,
        from,
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ],
        CHESS_MOVE_RANGE.rook,
      );
    case UnitType.DefensePost: // Bishop
      return slideMoves(
        mg,
        ownerId,
        from,
        [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ],
        CHESS_MOVE_RANGE.bishop,
      );
    case UnitType.Factory: // Queen
      return slideMoves(
        mg,
        ownerId,
        from,
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ],
        CHESS_MOVE_RANGE.queen,
      );
    case UnitType.MissileSilo: // Knight — variable L leap
      return legalKnightMoves(mg, ownerId, from);
    default:
      return [];
  }
}

export function isLegalMove(
  mg: ChessBoardView,
  unit: ChessPieceRef,
  dest: ChessCell,
): boolean {
  return legalMovesForPiece(mg, unit).some(
    (m) => m.cx === dest.cx && m.cy === dest.cy,
  );
}

/**
 * Truncate a path so it ends at the first cell matching hover (inclusive).
 * If hover is not in the path, return the path unchanged.
 */
export function truncatePathAt(
  path: ChessCell[],
  hover: ChessCell,
): ChessCell[] {
  const idx = path.findIndex((c) => c.cx === hover.cx && c.cy === hover.cy);
  if (idx < 0) return path;
  return path.slice(0, idx + 1);
}

/** Intermediate cells between from and to for sliding pieces (exclusive).
 *  Returns [] for leaps (knight) and non-slide moves — never loops forever.
 */
export function pathCells(from: ChessCell, to: ChessCell): ChessCell[] {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (dx === 0 && dy === 0) return [];

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  // Must be orthogonal or diagonal slide (equal abs steps on both axes).
  const isOrtho = dx === 0 || dy === 0;
  const isDiag = absDx === absDy;
  if (!isOrtho && !isDiag) return [];

  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const steps = Math.max(absDx, absDy);
  const cells: ChessCell[] = [];
  for (let i = 1; i < steps; i++) {
    cells.push({ cx: from.cx + stepX * i, cy: from.cy + stepY * i });
  }
  return cells;
}

/** Verify sliding path is clear (knight/king leap-style skip). */
export function slidingPathClear(
  mg: ChessBoardView,
  unit: ChessPieceRef,
  to: ChessCell,
): boolean {
  const type = unit.type();
  if (type === UnitType.MissileSilo || type === UnitType.City || type === UnitType.Workshop) {
    return true;
  }
  const from = tileToCell(mg, unit.tile());
  const dx = Math.sign(to.cx - from.cx);
  const dy = Math.sign(to.cy - from.cy);
  if (dx === 0 && dy === 0) return false;
  return clearPath(mg, from, to, dx, dy);
}
