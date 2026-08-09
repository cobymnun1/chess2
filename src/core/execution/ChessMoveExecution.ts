import {
  CHESS_MOVE_COOLDOWN,
  ChessPieceUnitType,
  isChessPieceType,
} from "../chess/ChessConstants";
import {
  cellCenterTile,
  isLegalMove,
  slidingPathClear,
  tileToCell,
  tilesInCell,
} from "../chess/ChessMoves";
import {
  chessPieceIdCooldownRemaining,
  getChessPieceByUnitId,
  setChessPieceMoveTick,
  unregisterChessPiece,
  updateChessPieceAfterTeleport,
  verifyAndRepairChessArmy,
} from "../chess/ChessPieceRegistry";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { attachChessPieceBehavior } from "./ChessSetupExecution";

/** Client/helper: cooldown for a live unit via registry pieceId. */
export function chessPieceCooldownRemaining(
  unit: {
    id(): number;
    type(): UnitType;
    owner(): { id(): string };
  },
  currentTick: number,
): number {
  if (!isChessPieceType(unit.type())) return 0;
  const rec = getChessPieceByUnitId(unit.owner().id(), unit.id());
  if (!rec) return 0;
  const cd = CHESS_MOVE_COOLDOWN[unit.type() as ChessPieceUnitType];
  return chessPieceIdCooldownRemaining(
    unit.owner().id(),
    rec.pieceId,
    cd,
    currentTick,
  );
}

/** Delete every enemy chess piece on a cell; unregister from their army.
 *  Returns false if another friendly piece occupies the square (no stacking).
 */
function clearChessCell(
  mg: Game,
  cx: number,
  cy: number,
  opts: {
    exceptUnitId?: number;
    capturer?: Player;
  } = {},
): boolean {
  const onCell = mg.units().filter((u) => {
    if (!u.isActive() || !isChessPieceType(u.type())) return false;
    if (opts.exceptUnitId !== undefined && u.id() === opts.exceptUnitId) {
      return false;
    }
    const c = tileToCell(mg, u.tile());
    return c.cx === cx && c.cy === cy;
  });

  if (
    opts.capturer &&
    onCell.some((u) => u.owner().id() === opts.capturer!.id())
  ) {
    return false;
  }

  for (const u of onCell) {
    const rec = getChessPieceByUnitId(u.owner().id(), u.id());
    if (rec) {
      unregisterChessPiece(u.owner().id(), rec.pieceId);
    }
    u.delete(false);
  }
  return true;
}

export class ChessMoveExecution implements Execution {
  private active = true;

  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly destTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.isValidRef(this.destTile)) {
      console.warn(`ChessMoveExecution: invalid dest ${this.destTile}`);
      this.active = false;
      return;
    }

    const playerId = this.owner.id();
    const rec = getChessPieceByUnitId(playerId, this.unitId);
    if (!rec) {
      console.warn(
        `ChessMoveExecution: unit ${this.unitId} not in piece registry`,
      );
      this.active = false;
      return;
    }

    const unit = this.owner
      .units()
      .find((u) => u.id() === rec.unitId && u.isActive());
    if (
      !unit ||
      !isChessPieceType(unit.type()) ||
      unit.type() !== rec.unitType
    ) {
      console.warn(`ChessMoveExecution: unit ${this.unitId} not a chess piece`);
      this.active = false;
      return;
    }

    const cd = CHESS_MOVE_COOLDOWN[rec.unitType];
    if (chessPieceIdCooldownRemaining(playerId, rec.pieceId, cd, ticks) > 0) {
      this.active = false;
      return;
    }

    const dest = tileToCell(mg, this.destTile);
    if (!isLegalMove(mg, unit, dest) || !slidingPathClear(mg, unit, dest)) {
      console.warn(`ChessMoveExecution: illegal move for ${this.unitId}`);
      this.active = false;
      return;
    }

    const from = tileToCell(mg, unit.tile());

    // Capture: any enemy chess piece on dest is removed from play + registry.
    // Refuse if another friendly piece already sits there (no stacking).
    if (
      !clearChessCell(mg, dest.cx, dest.cy, {
        exceptUnitId: unit.id(),
        capturer: this.owner,
      })
    ) {
      console.warn(
        `ChessMoveExecution: destination occupied by friendly piece`,
      );
      this.active = false;
      return;
    }

    // Chess 2: territory is only the square under the piece (no blob expand).
    // Conquer destination first so the player never briefly hits 0 tiles (dead).
    for (const t of tilesInCell(mg, dest.cx, dest.cy)) {
      if (mg.owner(t) !== this.owner) {
        this.owner.conquer(t);
      }
    }
    for (const t of tilesInCell(mg, from.cx, from.cy)) {
      if (mg.owner(t) === this.owner) {
        this.owner.relinquish(t);
      }
    }

    // Teleport: delete + rebuild so structure sprites relocate.
    const pieceType = rec.unitType;
    unit.delete(false);

    // Belt-and-suspenders: dest must be empty of chess pieces before rebuild.
    clearChessCell(mg, dest.cx, dest.cy, { capturer: this.owner });

    const cost = mg.unitInfo(pieceType).cost(mg, this.owner);
    this.owner.addGold(cost);
    const rebuilt = this.owner.buildUnit(
      pieceType,
      cellCenterTile(mg, dest.cx, dest.cy),
      {},
    );
    attachChessPieceBehavior(mg, this.owner, pieceType, rebuilt);

    updateChessPieceAfterTeleport(
      playerId,
      rec.pieceId,
      rebuilt.id(),
      dest.cx,
      dest.cy,
    );
    setChessPieceMoveTick(playerId, rec.pieceId, ticks);

    verifyAndRepairChessArmy(mg, this.owner, (type, u) =>
      attachChessPieceBehavior(mg, this.owner, type, u),
    );

    this.active = false;
  }

  tick(_ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
