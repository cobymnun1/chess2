import { UnitType } from "../game/Game";

/** Pixel size of one chess square on the Grid map (matches map-generator cell size). */
export const CHESS_CELL = 32;

/** Starting army footprint width/height in squares. */
export const CHESS_BOARD_SIZE = 6;

/** Structure types that represent chess pieces. */
export const CHESS_PIECE_TYPES = [
  UnitType.City, // King
  UnitType.Factory, // Queen
  UnitType.Port, // Rook
  UnitType.DefensePost, // Bishop
  UnitType.MissileSilo, // Knight
  UnitType.SAMLauncher, // Pawn
  UnitType.Workshop, // Production factory
] as const;

export type ChessPieceUnitType = (typeof CHESS_PIECE_TYPES)[number];

/** Products a Workshop can manufacture (no king). */
export const CHESS_FACTORY_PRODUCTS = [
  UnitType.Factory, // Queen
  UnitType.Port, // Rook
  UnitType.MissileSilo, // Knight
  UnitType.DefensePost, // Bishop
  UnitType.SAMLauncher, // Pawn
] as const;

export type ChessFactoryProduct = (typeof CHESS_FACTORY_PRODUCTS)[number];

export function isChessPieceType(type: UnitType): type is ChessPieceUnitType {
  return (CHESS_PIECE_TYPES as readonly UnitType[]).includes(type);
}

export function isChessFactoryProduct(
  type: UnitType,
): type is ChessFactoryProduct {
  return (CHESS_FACTORY_PRODUCTS as readonly UnitType[]).includes(type);
}

/**
 * Move cooldowns in ticks (10 ticks/s).
 * Pawn 3s, bishop/knight 5s, rook 8s, queen/king 10s, workshop 2s.
 */
export const CHESS_MOVE_COOLDOWN: Record<ChessPieceUnitType, number> = {
  [UnitType.City]: 100, // King — 10s
  [UnitType.Factory]: 100, // Queen — 10s
  [UnitType.Port]: 80, // Rook — 8s
  [UnitType.DefensePost]: 50, // Bishop — 5s
  [UnitType.MissileSilo]: 50, // Knight — 5s
  [UnitType.SAMLauncher]: 30, // Pawn — 3s
  [UnitType.Workshop]: 20, // Factory — 2s
};

/** Max move distance in chess cells. */
export const CHESS_MOVE_RANGE = {
  pawn: 3,
  king: 3,
  bishop: 12,
  rook: 16,
  queen: 16,
  knightMaxManhattan: 6,
  workshop: 1,
} as const;

/** Workshop build duration in ticks (10 ticks/s). */
export const CHESS_FACTORY_BUILD_TICKS: Record<ChessFactoryProduct, number> = {
  [UnitType.Factory]: 600, // Queen — 60s
  [UnitType.Port]: 450, // Rook — 45s
  [UnitType.MissileSilo]: 300, // Knight — 30s
  [UnitType.DefensePost]: 300, // Bishop — 30s
  [UnitType.SAMLauncher]: 150, // Pawn — 15s
};

/**
 * 6×6 starting formation (row = local cy, col = local cx).
 *
 * ```
 * P P P P P P
 * P R H B R P
 * P B K F H P
 * P H F Q B P
 * P R B H R P
 * P P P P P P
 * ```
 */
export const CHESS_START_FORMATION: ReadonlyArray<
  ReadonlyArray<ChessPieceUnitType | null>
> = (() => {
  const R = UnitType.Port;
  const N = UnitType.MissileSilo;
  const B = UnitType.DefensePost;
  const Q = UnitType.Factory;
  const K = UnitType.City;
  const P = UnitType.SAMLauncher;
  const F = UnitType.Workshop;
  return [
    [P, P, P, P, P, P],
    [P, R, N, B, R, P],
    [P, B, K, F, N, P],
    [P, N, F, Q, B, P],
    [P, R, B, N, R, P],
    [P, P, P, P, P, P],
  ];
})();
