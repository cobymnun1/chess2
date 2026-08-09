import {
  CHESS_BACK_RANK,
  CHESS_BOARD_SIZE,
  CHESS_CELL,
  ChessPieceUnitType,
} from "../chess/ChessConstants";
import { cellCenterTile, tilesInCell } from "../chess/ChessMoves";
import {
  clearChessArmy,
  registerChessPiece,
} from "../chess/ChessPieceRegistry";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { CityExecution } from "./CityExecution";
import { DefensePostExecution } from "./DefensePostExecution";
import { FactoryExecution } from "./FactoryExecution";
import { MissileSiloExecution } from "./MissileSiloExecution";
import { PortExecution } from "./PortExecution";
import { SAMLauncherExecution } from "./SAMLauncherExecution";

/** Attach structure behavior executions used by chess pieces. */
export function attachChessPieceBehavior(
  mg: Game,
  player: Player,
  type: UnitType,
  unit: Unit,
): void {
  switch (type) {
    case UnitType.Port:
      mg.addExecution(new PortExecution(unit));
      break;
    case UnitType.MissileSilo:
      mg.addExecution(new MissileSiloExecution(unit));
      break;
    case UnitType.DefensePost:
      mg.addExecution(new DefensePostExecution(unit));
      break;
    case UnitType.SAMLauncher:
      mg.addExecution(new SAMLauncherExecution(player, null, unit));
      break;
    case UnitType.City:
      mg.addExecution(new CityExecution(unit));
      break;
    case UnitType.Factory:
      mg.addExecution(new FactoryExecution(unit));
      break;
  }
}

/**
 * Places a standard chess army for the human player on Grid.
 * Calls buildUnit directly (bypasses canBuild spacing / Port shore rules)
 * and refunds gold so setup is free.
 */
export class ChessSetupExecution implements Execution {
  private active = true;
  private mg: Game;
  private nextPieceId = 0;

  constructor(
    private readonly player: Player,
    /** Top-left chess cell of the 8×8 board. */
    private readonly originCx: number,
    private readonly originCy: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    clearChessArmy(this.player.id());
    this.nextPieceId = 0;

    for (let file = 0; file < CHESS_BOARD_SIZE; file++) {
      // Back rank at bottom of board (highest cy).
      const backCy = this.originCy + CHESS_BOARD_SIZE - 1;
      const pawnCy = this.originCy + CHESS_BOARD_SIZE - 2;
      const cx = this.originCx + file;

      this.placePiece(CHESS_BACK_RANK[file], cx, backCy);
      this.placePiece(UnitType.SAMLauncher, cx, pawnCy);
    }
    this.active = false;
  }

  tick(_ticks: number): void {}

  private placePiece(type: ChessPieceUnitType, cx: number, cy: number): void {
    const tile = cellCenterTile(this.mg, cx, cy);
    // Ensure ownership of the cell before placing.
    for (const t of tilesInCell(this.mg, cx, cy)) {
      if (this.mg.owner(t) !== this.player) {
        this.player.conquer(t);
      }
    }

    const cost = this.mg.unitInfo(type).cost(this.mg, this.player);
    this.player.addGold(cost);
    const unit = this.player.buildUnit(type, tile, {});
    attachChessPieceBehavior(this.mg, this.player, type, unit);

    const pieceId = this.nextPieceId++;
    registerChessPiece(this.player.id(), {
      pieceId,
      unitType: type,
      unitId: unit.id(),
      cx,
      cy,
    });
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}

/** Compute a board origin snapped so the click is near the center of an 8×8. */
export function chessBoardOriginFromTile(
  mg: Game,
  center: TileRef,
): { originCx: number; originCy: number } {
  const clickCx = Math.floor(mg.x(center) / CHESS_CELL);
  const clickCy = Math.floor(mg.y(center) / CHESS_CELL);
  const maxCx = Math.floor((mg.width() - 1) / CHESS_CELL);
  const maxCy = Math.floor((mg.height() - 1) / CHESS_CELL);
  const originCx = Math.max(
    0,
    Math.min(
      clickCx - Math.floor(CHESS_BOARD_SIZE / 2),
      maxCx - CHESS_BOARD_SIZE + 1,
    ),
  );
  const originCy = Math.max(
    0,
    Math.min(
      clickCy - Math.floor(CHESS_BOARD_SIZE / 2),
      maxCy - CHESS_BOARD_SIZE + 1,
    ),
  );
  return { originCx, originCy };
}

/** Tiles under the starting army only (back rank + pawn rank) — not the empty board. */
export function chessArmyTiles(
  mg: Game,
  originCx: number,
  originCy: number,
): TileRef[] {
  const tiles: TileRef[] = [];
  const backCy = originCy + CHESS_BOARD_SIZE - 1;
  const pawnCy = originCy + CHESS_BOARD_SIZE - 2;
  for (const cy of [backCy, pawnCy]) {
    for (let file = 0; file < CHESS_BOARD_SIZE; file++) {
      tiles.push(...tilesInCell(mg, originCx + file, cy));
    }
  }
  return tiles;
}

/** All tiles belonging to an 8×8 chess board starting at origin cell. */
export function chessBoardTiles(
  mg: Game,
  originCx: number,
  originCy: number,
): TileRef[] {
  const tiles: TileRef[] = [];
  for (let cy = originCy; cy < originCy + CHESS_BOARD_SIZE; cy++) {
    for (let cx = originCx; cx < originCx + CHESS_BOARD_SIZE; cx++) {
      tiles.push(...tilesInCell(mg, cx, cy));
    }
  }
  return tiles;
}
