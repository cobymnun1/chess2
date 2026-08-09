import {
  CHESS_MOVE_COOLDOWN,
  ChessPieceUnitType,
  isChessPieceType,
} from "../../core/chess/ChessConstants";
import { tileToCell } from "../../core/chess/ChessMoves";
import { GameView, UnitView } from "../view";

interface PendingCooldown {
  type: ChessPieceUnitType;
  destCx: number;
  destCy: number;
  readyTick: number;
  totalTicks: number;
}

interface BoundCooldown {
  readyTick: number;
  totalTicks: number;
}

/**
 * Client-side chess move cooldowns. The worker registry is not shared with the
 * main thread, so UI pies must track CD after teleport (new unit ids).
 */
export class ChessCooldownTracker {
  private pending: PendingCooldown[] = [];
  private byUnitId = new Map<number, BoundCooldown>();

  /** Call when the player emits a chess move intent. */
  recordMove(unit: UnitView, destCx: number, destCy: number, tick: number) {
    if (!isChessPieceType(unit.type())) return;
    const type = unit.type() as ChessPieceUnitType;
    const totalTicks = CHESS_MOVE_COOLDOWN[type];
    this.pending.push({
      type,
      destCx,
      destCy,
      readyTick: tick + totalTicks,
      totalTicks,
    });
    // Drop any CD still keyed to the old (about-to-delete) unit id.
    this.byUnitId.delete(unit.id());
  }

  /** Bind pending CDs to live units after teleport; prune expired. */
  sync(game: GameView, tick: number) {
    const me = game.myPlayer();
    if (!me) {
      this.pending = [];
      this.byUnitId.clear();
      return;
    }

    const stillPending: PendingCooldown[] = [];
    for (const p of this.pending) {
      if (p.readyTick <= tick) continue;
      const unit = this.findOwnPieceAt(game, me.units(p.type), p.destCx, p.destCy);
      if (unit) {
        this.byUnitId.set(unit.id(), {
          readyTick: p.readyTick,
          totalTicks: p.totalTicks,
        });
      } else {
        stillPending.push(p);
      }
    }
    this.pending = stillPending;

    for (const [id, cd] of [...this.byUnitId.entries()]) {
      if (cd.readyTick <= tick) {
        this.byUnitId.delete(id);
        continue;
      }
      const live = me.units().find((u) => u.id() === id && u.isActive());
      if (!live) this.byUnitId.delete(id);
    }
  }

  /** Fraction of CD still remaining in [0, 1]. */
  remainingFraction(unitId: number, tick: number): number {
    const cd = this.byUnitId.get(unitId);
    if (!cd || cd.totalTicks <= 0) return 0;
    return Math.min(1, Math.max(0, (cd.readyTick - tick) / cd.totalTicks));
  }

  private findOwnPieceAt(
    game: GameView,
    units: UnitView[],
    cx: number,
    cy: number,
  ): UnitView | null {
    for (const u of units) {
      if (!u.isActive() || !isChessPieceType(u.type())) continue;
      const c = tileToCell(game, u.tile());
      if (c.cx === cx && c.cy === cy) return u;
    }
    return null;
  }
}
