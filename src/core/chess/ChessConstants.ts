import { UnitType } from "../game/Game";

/** Pixel size of one chess square on the Grid map (matches map-generator cell size). */
export const CHESS_CELL = 32;

/** Standard chess board width/height in squares. */
export const CHESS_BOARD_SIZE = 8;

/** Structure types that represent chess pieces. */
export const CHESS_PIECE_TYPES = [
  UnitType.City, // King
  UnitType.Factory, // Queen
  UnitType.Port, // Rook
  UnitType.DefensePost, // Bishop
  UnitType.MissileSilo, // Knight
  UnitType.SAMLauncher, // Pawn
] as const;

export type ChessPieceUnitType = (typeof CHESS_PIECE_TYPES)[number];

export function isChessPieceType(type: UnitType): type is ChessPieceUnitType {
  return (CHESS_PIECE_TYPES as readonly UnitType[]).includes(type);
}

/**
 * Move cooldowns in ticks (10 ticks/s).
 * Pawn 3s, bishop/knight 5s, rook 8s, queen/king 10s.
 */
export const CHESS_MOVE_COOLDOWN: Record<ChessPieceUnitType, number> = {
  [UnitType.City]: 100, // King — 10s
  [UnitType.Factory]: 100, // Queen — 10s
  [UnitType.Port]: 80, // Rook — 8s
  [UnitType.DefensePost]: 50, // Bishop — 5s
  [UnitType.MissileSilo]: 50, // Knight — 5s
  [UnitType.SAMLauncher]: 30, // Pawn — 3s
};

/** Max move distance in chess cells. */
export const CHESS_MOVE_RANGE = {
  pawn: 3,
  king: 3,
  bishop: 12,
  rook: 16,
  queen: 16,
  knightMaxManhattan: 6,
} as const;

/** Back rank left→right, then pawns. Player's side sits on the bottom of the board. */
export const CHESS_BACK_RANK: ChessPieceUnitType[] = [
  UnitType.Port, // Rook
  UnitType.MissileSilo, // Knight
  UnitType.DefensePost, // Bishop
  UnitType.Factory, // Queen
  UnitType.City, // King
  UnitType.DefensePost, // Bishop
  UnitType.MissileSilo, // Knight
  UnitType.Port, // Rook
];
