import { EventBus } from "../../core/EventBus";
import {
  CHESS_CELL,
  CHESS_PIECE_TYPES,
  isChessPieceType,
} from "../../core/chess/ChessConstants";
import {
  bestKnightLanding,
  cellCenterTile,
  ChessCell,
  knightLPath,
  knightPreferAxisFromCursor,
  legalMovesForPiece,
  pathCells,
  tileToCell,
  truncatePathAt,
} from "../../core/chess/ChessMoves";
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
import { ChessCooldownTracker } from "./ChessCooldownTracker";

const PATH_BORDER = "2px solid rgba(120,200,255,0.65)";
const PATH_BG = "rgba(120,200,255,0.18)";
const LEGAL_BORDER = "2px solid rgba(120,200,255,0.45)";
const LEGAL_BG = "rgba(120,200,255,0.12)";
const END_BORDER = "2px solid rgba(120,200,255,0.95)";
const END_BG = "rgba(120,200,255,0.32)";

/**
 * Select-and-move UI for chess pieces on the Grid map.
 * Click own piece → blue legal cells → hover truncates path → click to move.
 * Knights use aim-snap; all pieces show client cooldown pies.
 */
export class ChessMoveController implements Controller {
  private selected: UnitView | null = null;
  private legal: ChessCell[] = [];
  private overlayRoot: HTMLDivElement | null = null;
  private cursorCell: ChessCell | null = null;
  private knightSnap: ChessCell | null = null;
  private readonly cooldowns = new ChessCooldownTracker();
  /** Last camera key used for overlay layout (scale/pan/viewport). */
  private lastCameraKey = "";
  private rafId: number | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {}

  init() {
    this.eventBus.on(MouseUpEvent, (e) => this.onMouseUp(e));
    this.eventBus.on(MouseMoveEvent, (e) => this.onMouseMove(e));
    this.eventBus.on(CloseViewEvent, () => this.clearSelection());
    // Keep DOM overlays glued to world cells while the camera pans/zooms
    // (game tick is only 10Hz and lags behind the render loop).
    this.rafId = requestAnimationFrame(() => this.cameraSyncLoop());
  }

  tick() {
    if (!this.isChessMode()) {
      this.clearSelection();
      this.clearOverlay();
      this.lastCameraKey = "";
      return;
    }
    this.cooldowns.sync(this.game, this.game.ticks());
    if (this.selected && !this.selected.isActive()) {
      this.clearSelection();
    }
    if (this.selected) {
      this.refreshLegal();
      this.updateKnightSnap();
    }
    this.renderOverlay();
  }

  private cameraKey(): string {
    const r = this.transformHandler.boundingRect();
    const th = this.transformHandler;
    return `${th.scale}:${th.offsetX}:${th.offsetY}:${r.left}:${r.top}:${r.width}:${r.height}`;
  }

  private cameraSyncLoop() {
    this.rafId = requestAnimationFrame(() => this.cameraSyncLoop());
    if (!this.isChessMode()) return;
    const key = this.cameraKey();
    if (key === this.lastCameraKey) return;
    this.renderOverlay();
  }

  private isChessMode(): boolean {
    return this.game.config().gameConfig().gameMap === GameMapType.Grid;
  }

  private isKnight(unit: UnitView | null): boolean {
    return unit !== null && unit.type() === UnitType.MissileSilo;
  }

  private onMouseMove(e: MouseMoveEvent) {
    if (!this.isChessMode()) return;
    const world = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(world.x, world.y)) return;
    const tile = this.game.ref(world.x, world.y);
    this.cursorCell = tileToCell(this.game, tile);
    if (this.selected) {
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

  private emitMove(unit: UnitView, dest: ChessCell) {
    const tick = this.game.ticks();
    this.cooldowns.recordMove(unit, dest.cx, dest.cy, tick);
    const destTile = cellCenterTile(this.game, dest.cx, dest.cy);
    this.eventBus.emit(new MoveChessPieceIntentEvent(unit.id(), destTile));
    this.clearSelection();
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
          this.emitMove(this.selected, this.knightSnap);
          return;
        }
      } else {
        const hit = this.legal.find((c) => c.cx === cell.cx && c.cy === cell.cy);
        if (hit) {
          this.emitMove(this.selected, hit);
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
    for (const type of CHESS_PIECE_TYPES) {
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

  private cellScreenRect(cell: ChessCell): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    const x0 = cell.cx * CHESS_CELL;
    const y0 = cell.cy * CHESS_CELL;
    const topLeft = this.transformHandler.worldToScreenCoordinates(
      new Cell(x0, y0),
    );
    const bottomRight = this.transformHandler.worldToScreenCoordinates(
      new Cell(x0 + CHESS_CELL, y0 + CHESS_CELL),
    );
    return {
      left: Math.min(topLeft.x, bottomRight.x),
      top: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y),
    };
  }

  private paintCell(cell: ChessCell, border: string, background: string) {
    if (!this.overlayRoot) return;
    const { left, top, width, height } = this.cellScreenRect(cell);
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

  private paintCooldownPie(cell: ChessCell, remainingFraction: number) {
    if (!this.overlayRoot || remainingFraction <= 0) return;
    const { left, top, width, height } = this.cellScreenRect(cell);
    const size = Math.min(width, height) * 0.75;
    const pie = document.createElement("div");
    pie.style.position = "absolute";
    pie.style.left = `${left + (width - size) / 2}px`;
    pie.style.top = `${top + (height - size) / 2}px`;
    pie.style.width = `${size}px`;
    pie.style.height = `${size}px`;
    pie.style.borderRadius = "50%";
    pie.style.pointerEvents = "none";
    const deg = remainingFraction * 360;
    pie.style.background = `conic-gradient(rgba(40,40,40,0.55) 0deg ${deg}deg, transparent ${deg}deg 360deg)`;
    this.overlayRoot.appendChild(pie);
  }

  /** Path from piece to hovered/snap target, truncated if cursor is on the path. */
  private hoverPath(): ChessCell[] {
    if (!this.selected) return [];
    const from = tileToCell(this.game, this.selected.tile());

    if (this.isKnight(this.selected) && this.knightSnap) {
      const prefer = this.cursorCell
        ? knightPreferAxisFromCursor(from, this.cursorCell)
        : "horizontal";
      const full = [
        ...knightLPath(from, this.knightSnap, prefer),
        this.knightSnap,
      ];
      if (this.cursorCell) {
        return truncatePathAt(full, this.cursorCell);
      }
      return full;
    }

    if (!this.cursorCell) return [];
    const hoverLegal = this.legal.find(
      (c) => c.cx === this.cursorCell!.cx && c.cy === this.cursorCell!.cy,
    );
    if (!hoverLegal) return [];

    const intermediates = pathCells(from, hoverLegal);
    const full = [...intermediates, hoverLegal];
    return truncatePathAt(full, this.cursorCell);
  }

  private renderOverlay() {
    this.ensureOverlay();
    if (!this.overlayRoot) return;
    this.overlayRoot.innerHTML = "";
    this.lastCameraKey = this.cameraKey();

    const tick = this.game.ticks();

    if (this.selected) {
      const path = this.hoverPath();
      const pathKeys = new Set(path.map((c) => `${c.cx},${c.cy}`));

      // All legal landings in dimmer blue (skip cells already on the bright path).
      for (const cell of this.legal) {
        if (pathKeys.has(`${cell.cx},${cell.cy}`)) continue;
        this.paintCell(cell, LEGAL_BORDER, LEGAL_BG);
      }

      // Hover / aim path in stronger blue; last cell is the end.
      for (let i = 0; i < path.length; i++) {
        const isEnd = i === path.length - 1;
        this.paintCell(
          path[i],
          isEnd ? END_BORDER : PATH_BORDER,
          isEnd ? END_BG : PATH_BG,
        );
      }
    }

    // Cooldown pies on all own chess pieces.
    const me = this.game.myPlayer();
    if (me) {
      for (const type of CHESS_PIECE_TYPES) {
        for (const u of me.units(type)) {
          if (!u.isActive()) continue;
          const frac = this.cooldowns.remainingFraction(u.id(), tick);
          if (frac <= 0) continue;
          const c = tileToCell(this.game, u.tile());
          this.paintCooldownPie(c, frac);
        }
      }
    }
  }
}
