import {
  CHESS_BOARD_SIZE,
  CHESS_CELL,
  CHESS_START_FORMATION,
  ChessPieceUnitType,
  isChessPieceType,
} from "../chess/ChessConstants";
import { cellCenterTile, tileToCell, tilesInCell } from "../chess/ChessMoves";
import {
  clearChessArmy,
  listChessPieces,
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
    case UnitType.Workshop:
      // Production handled by ChessFactoryBuildExecution; no OF factory rails.
      break;
  }
}

/**
 * Places the 6×6 chess army for the human player on Grid.
 * Calls buildUnit directly (bypasses canBuild spacing / Port shore rules)
 * and refunds gold so setup is free.
 */
export class ChessSetupExecution implements Execution {
  private active = true;
  private mg: Game;
  private nextPieceId = 0;

  constructor(
    private readonly player: Player,
    /** Top-left chess cell of the army footprint. */
    private readonly originCx: number,
    private readonly originCy: number,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    // Idempotent: never place a second army for the same player.
    if (listChessPieces(this.player.id()).length > 0) {
      const live = this.player
        .units()
        .filter((u) => u.isActive() && isChessPieceType(u.type()));
      if (live.length > 0) {
        this.active = false;
        return;
      }
    }

    // Remove any leftover chess structures from a prior bad setup.
    for (const u of [...this.player.units()]) {
      if (u.isActive() && isChessPieceType(u.type())) {
        u.delete(false);
      }
    }
    clearChessArmy(this.player.id());
    this.nextPieceId = 0;

    // Own the full 6×6 footprint (including intentional blanks).
    for (let ly = 0; ly < CHESS_BOARD_SIZE; ly++) {
      for (let lx = 0; lx < CHESS_BOARD_SIZE; lx++) {
        const cx = this.originCx + lx;
        const cy = this.originCy + ly;
        for (const t of tilesInCell(this.mg, cx, cy)) {
          if (this.mg.owner(t) !== this.player) {
            this.player.conquer(t);
          }
        }
      }
    }

    for (let ly = 0; ly < CHESS_BOARD_SIZE; ly++) {
      for (let lx = 0; lx < CHESS_BOARD_SIZE; lx++) {
        const type = CHESS_START_FORMATION[ly][lx];
        if (type === null) continue;
        this.placePiece(type, this.originCx + lx, this.originCy + ly);
      }
    }
    this.active = false;
  }

  tick(_ticks: number): void {}

  private placePiece(type: ChessPieceUnitType, cx: number, cy: number): void {
    const tile = cellCenterTile(this.mg, cx, cy);

    // No stacking: clear any units already on this chess cell.
    for (const u of [...this.mg.units()]) {
      if (!u.isActive() || !isChessPieceType(u.type())) continue;
      const c = tileToCell(this.mg, u.tile());
      if (c.cx === cx && c.cy === cy) {
        u.delete(false);
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

/** Compute a board origin snapped so the click is near the center of the army. */
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

/** All land tiles under the 6×6 starting army footprint (including blanks). */
export function chessArmyTiles(
  mg: Game,
  originCx: number,
  originCy: number,
): TileRef[] {
  return chessBoardTiles(mg, originCx, originCy);
}

/** All tiles belonging to the army footprint starting at origin cell. */
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
