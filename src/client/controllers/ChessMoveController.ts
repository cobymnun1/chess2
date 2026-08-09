import { EventBus } from "../../core/EventBus";
import { CHESS_CELL, isChessPieceType } from "../../core/chess/ChessConstants";
import {
  bestKnightLanding,
  cellCenterTile,
  ChessCell,
  knightLPath,
  knightPreferAxisFromCursor,
  legalMovesForPiece,
  tileToCell,
} from "../../core/chess/ChessMoves";
import { chessPieceCooldownRemaining } from "../../core/execution/ChessMoveExecution";
import { Cell, GameMapType, UnitType } from "../../core/game/Game";
import { Controller } from "../Controller";
import {
  CloseViewEvent,
  MouseMoveEvent,
  MouseUpEvent,
} from "../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { MoveChessPieceIntentEvent } from "../Transport";
import { GameView, UnitView } from "../view";

/**
 * Select-and-move UI for chess pieces on the Grid map.
 * Click own piece → show legal cells → click cell to move.
 * Knights use aim-snap: mouse picks best L landing; click confirms.
 */
export class ChessMoveController implements Controller {
  private selected: UnitView | null = null;
  private legal: ChessCell[] = [];
  private overlayRoot: HTMLDivElement | null = null;
  private cursorCell: ChessCell | null = null;
  private knightSnap: ChessCell | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
    this.eventBus.on(CloseViewEvent, () => this.clearSelection());
  }

  tick() {
    if (!this.isChessMode()) {
      this.clearSelection();
      return;
    }
    if (this.selected && !this.selected.isActive()) {
      this.clearSelection();
      return;
    }
    if (this.selected) {
      this.refreshLegal();
      this.updateKnightSnap();
      this.renderOverlay();
    }
  }

  private isChessMode(): boolean {
    return this.game.config().gameConfig().gameMap === GameMapType.Grid;
  }

  private isKnight(unit: UnitView | null): boolean {
    return unit !== null && unit.type() === UnitType.MissileSilo;
  }

  private onMouseMove(e: MouseMoveEvent) {
    if (!this.isChessMode() || !this.selected) return;
    const world = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(world.x, world.y)) return;
    const tile = this.game.ref(world.x, world.y);
    this.cursorCell = tileToCell(this.game, tile);
    if (this.isKnight(this.selected)) {
      this.updateKnightSnap();
      this.renderOverlay();
    }
  }

  private updateKnightSnap() {
    if (!this.selected || !this.isKnight(this.selected)) {
      this.knightSnap = null;
      return;
    }
    if (!this.cursorCell) {
      this.knightSnap = this.legal[0] ?? null;
      return;
    }
    const from = tileToCell(this.game, this.selected.tile());
    this.knightSnap = bestKnightLanding(from, this.legal, this.cursorCell);
  }

  private onMouseUp(e: MouseUpEvent) {
    if (!this.isChessMode()) return;
    const me = this.game.myPlayer();
    if (!me || !me.isAlive() || this.game.inSpawnPhase()) return;

    const world = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(world.x, world.y)) return;
    const tile = this.game.ref(world.x, world.y);
    const cell = tileToCell(this.game, tile);
    this.cursorCell = cell;

    if (this.selected) {
      // Click another own piece to retarget selection.
      const other = this.pieceAtCell(cell.cx, cell.cy);
      if (
        other &&
        other.owner().smallID() === me.smallID() &&
        other.id() !== this.selected.id()
      ) {
        this.selectPiece(other);
        return;
      }

      if (this.isKnight(this.selected)) {
        this.updateKnightSnap();
        if (this.knightSnap) {
          const dest = cellCenterTile(
            this.game,
            this.knightSnap.cx,
            this.knightSnap.cy,
          );
          this.eventBus.emit(
            new MoveChessPieceIntentEvent(this.selected.id(), dest),
          );
          this.clearSelection();
          return;
        }
      } else {
        const hit = this.legal.find((c) => c.cx === cell.cx && c.cy === cell.cy);
        if (hit) {
          const dest = cellCenterTile(this.game, hit.cx, hit.cy);
          this.eventBus.emit(
            new MoveChessPieceIntentEvent(this.selected.id(), dest),
          );
          this.clearSelection();
          return;
        }
      }
      this.clearSelection();
      return;
    }

    const piece = this.pieceAtCell(cell.cx, cell.cy);
    if (piece && piece.owner().smallID() === me.smallID()) {
      this.selectPiece(piece);
    }
  }

  private pieceAtCell(cx: number, cy: number): UnitView | null {
    const me = this.game.myPlayer();
    if (!me) return null;
    for (const type of [
      UnitType.City,
      UnitType.Factory,
      UnitType.Port,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.SAMLauncher,
    ]) {
      for (const u of me.units(type)) {
        if (!u.isActive() || !isChessPieceType(u.type())) continue;
        const c = tileToCell(this.game, u.tile());
        if (c.cx === cx && c.cy === cy) return u;
      }
    }
    return null;
  }

  private selectPiece(unit: UnitView) {
    this.selected = unit;
    this.refreshLegal();
    this.updateKnightSnap();
    this.renderOverlay();
  }

  private refreshLegal() {
    if (!this.selected) {
      this.legal = [];
      return;
    }
    this.legal = legalMovesForPiece(this.game, this.selected);
  }

  private clearSelection() {
    this.selected = null;
    this.legal = [];
    this.knightSnap = null;
    this.clearOverlay();
  }

  private ensureOverlay() {
    if (this.overlayRoot) return;
    const el = document.createElement("div");
    el.id = "chess-move-overlay";
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "40";
    document.body.appendChild(el);
    this.overlayRoot = el;
  }

  private clearOverlay() {
    if (this.overlayRoot) {
      this.overlayRoot.innerHTML = "";
    }
  }

  private paintCell(
    cell: ChessCell,
    border: string,
    background: string,
  ) {
    if (!this.overlayRoot) return;
    const x0 = cell.cx * CHESS_CELL;
    const y0 = cell.cy * CHESS_CELL;
    const topLeft = this.transformHandler.worldToScreenCoordinates(
      new Cell(x0, y0),
    );
    const bottomRight = this.transformHandler.worldToScreenCoordinates(
      new Cell(x0 + CHESS_CELL, y0 + CHESS_CELL),
    );
    const left = Math.min(topLeft.x, bottomRight.x);
    const top = Math.min(topLeft.y, bottomRight.y);
    const width = Math.abs(bottomRight.x - topLeft.x);
    const height = Math.abs(bottomRight.y - topLeft.y);
    const square = document.createElement("div");
    square.style.position = "absolute";
    square.style.left = `${left}px`;
    square.style.top = `${top}px`;
    square.style.width = `${width}px`;
    square.style.height = `${height}px`;
    square.style.boxSizing = "border-box";
    square.style.border = border;
    square.style.background = background;
    this.overlayRoot.appendChild(square);
  }

  private renderOverlay() {
    this.ensureOverlay();
    if (!this.overlayRoot) return;
    this.overlayRoot.innerHTML = "";
    if (!this.selected) return;

    const tick = this.game.ticks();
    const onCd = chessPieceCooldownRemaining(this.selected, tick) > 0;
    const destBorder = onCd
      ? "2px solid rgba(255,200,80,0.5)"
      : "2px solid rgba(80,220,120,0.85)";
    const destBg = onCd
      ? "rgba(255,200,80,0.12)"
      : "rgba(80,220,120,0.22)";
    const pathBorder = onCd
      ? "2px solid rgba(255,200,80,0.35)"
      : "2px solid rgba(120,200,255,0.65)";
    const pathBg = onCd
      ? "rgba(255,200,80,0.08)"
      : "rgba(120,200,255,0.18)";

    if (this.isKnight(this.selected) && this.knightSnap) {
      const from = tileToCell(this.game, this.selected.tile());
      const prefer = this.cursorCell
        ? knightPreferAxisFromCursor(from, this.cursorCell)
        : "horizontal";
      for (const cell of knightLPath(from, this.knightSnap, prefer)) {
        this.paintCell(cell, pathBorder, pathBg);
      }
      this.paintCell(this.knightSnap, destBorder, destBg);
      return;
    }

    for (const cell of this.legal) {
      this.paintCell(cell, destBorder, destBg);
    }
  }
}
