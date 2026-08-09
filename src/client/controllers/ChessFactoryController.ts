import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import {
  CHESS_CELL,
  CHESS_FACTORY_BUILD_TICKS,
  CHESS_FACTORY_PRODUCTS,
  ChessFactoryProduct,
} from "../../core/chess/ChessConstants";
import { tileToCell, workshopHasOpenNeighbor } from "../../core/chess/ChessMoves";
import { Cell, GameMapType, UnitType } from "../../core/game/Game";
import { Controller } from "../Controller";
import { CloseViewEvent, ContextMenuEvent } from "../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { ChessFactoryBuildIntentEvent, MoveChessPieceIntentEvent } from "../Transport";
import { GameView, UnitView } from "../view";
import { RadialMenu, RadialMenuConfig } from "../hud/layers/RadialMenu";
import {
  CenterButtonElement,
  COLORS,
  MenuElement,
  MenuElementParams,
} from "../hud/layers/RadialMenuElements";

const queenIcon = assetUrl("images/ChessQueenIconWhite.svg");
const rookIcon = assetUrl("images/ChessRookIconWhite.svg");
const knightIcon = assetUrl("images/ChessKnightIconWhite.svg");
const bishopIcon = assetUrl("images/ChessBishopIconWhite.svg");
const pawnIcon = assetUrl("images/ChessPawnIconWhite.svg");
const factoryIcon = assetUrl("images/ChessFactoryIconWhite.svg");

const PRODUCT_ICONS: Record<ChessFactoryProduct, string> = {
  [UnitType.Factory]: queenIcon,
  [UnitType.Port]: rookIcon,
  [UnitType.MissileSilo]: knightIcon,
  [UnitType.DefensePost]: bishopIcon,
  [UnitType.SAMLauncher]: pawnIcon,
};

const PRODUCT_I18N: Record<ChessFactoryProduct, string> = {
  [UnitType.Factory]: "unit_type.factory",
  [UnitType.Port]: "unit_type.port",
  [UnitType.MissileSilo]: "unit_type.missile_silo",
  [UnitType.DefensePost]: "unit_type.defense_post",
  [UnitType.SAMLauncher]: "unit_type.sam_launcher",
};

interface PendingBuild {
  destCx: number;
  destCy: number;
  readyTick: number;
  totalTicks: number;
  workshopUnitId: number;
}

interface BoundBuild {
  readyTick: number;
  totalTicks: number;
  /** Finished but waiting for an open neighbor to deposit. */
  holding: boolean;
  /** Adjacent chess pieces at build start — deposit raises this. */
  adjacentAtStart: number;
}

/**
 * Right-click Workshop → production radial (Q/R/N/B/P, no king).
 * Client build progress pies mirror move-CD tracking.
 */
export class ChessFactoryController implements Controller {
  private radialMenu: RadialMenu;
  private workshop: UnitView | null = null;
  private overlayRoot: HTMLDivElement | null = null;
  private pending: PendingBuild[] = [];
  private byUnitId = new Map<number, BoundBuild>();
  private lastCameraKey = "";
  private rafId: number | null = null;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
  ) {
    const menuConfig: RadialMenuConfig = {
      centerButtonIcon: factoryIcon,
      tooltipStyle: `
        .radial-tooltip .cost {
          margin-top: 4px;
          color: ${COLORS.tooltip.cost};
        }
      `,
    };

    const root: MenuElement = {
      id: "chess_factory_root",
      name: "factory",
      disabled: () => false,
      subMenu: () => this.productMenuItems(),
    };

    const center: CenterButtonElement = {
      disabled: () => true,
      action: () => {},
    };

    this.radialMenu = new RadialMenu(this.eventBus, root, center, menuConfig);
  }

  init() {
    this.radialMenu.init();
    this.eventBus.on(ContextMenuEvent, (e) => this.onContextMenu(e));
    this.eventBus.on(CloseViewEvent, () => this.hide());
    this.eventBus.on(MoveChessPieceIntentEvent, (e) => {
      this.cancelBuildForUnit(e.unitId);
    });
    this.rafId = requestAnimationFrame(() => this.cameraSyncLoop());
  }

  tick() {
    if (!this.isChessMode()) {
      this.hide();
      this.pending = [];
      this.byUnitId.clear();
      return;
    }
    this.syncBuilds(this.game.ticks());
    this.renderBuildPies();
  }

  private isChessMode(): boolean {
    return this.game.config().gameConfig().gameMap === GameMapType.Grid;
  }

  private onContextMenu(e: ContextMenuEvent) {
    if (!this.isChessMode()) return;
    const me = this.game.myPlayer();
    if (!me || !me.isAlive() || this.game.inSpawnPhase()) return;

    const world = this.transformHandler.screenToWorldCoordinates(e.x, e.y);
    if (!this.game.isValidCoord(world.x, world.y)) return;
    const tile = this.game.ref(world.x, world.y);
    const cell = tileToCell(this.game, tile);

    const workshop = me.units(UnitType.Workshop).find((u) => {
      if (!u.isActive()) return false;
      const c = tileToCell(this.game, u.tile());
      return c.cx === cell.cx && c.cy === cell.cy;
    });

    if (!workshop) return;

    this.workshop = workshop;

    // Minimal params so RadialMenu resetMenu can call subMenu.
    const params = {
      myPlayer: me,
      selected: null,
      tile,
      playerActions: null as unknown as MenuElementParams["playerActions"],
      game: this.game,
      buildMenu: null as unknown as MenuElementParams["buildMenu"],
      emojiTable: null as unknown as MenuElementParams["emojiTable"],
      playerActionHandler:
        null as unknown as MenuElementParams["playerActionHandler"],
      playerPanel: null as unknown as MenuElementParams["playerPanel"],
      chatIntegration: null as unknown as MenuElementParams["chatIntegration"],
      eventBus: this.eventBus,
      closeMenu: () => this.hide(),
    } satisfies MenuElementParams;

    this.radialMenu.setParams(params);
    this.radialMenu.showRadialMenu(e.x, e.y);
  }

  private productMenuItems(): MenuElement[] {
    return CHESS_FACTORY_PRODUCTS.map((product) => ({
      id: `factory_build_${product}`,
      name: product,
      icon: PRODUCT_ICONS[product],
      color: COLORS.build,
      disabled: () => {
        if (!this.workshop || !this.workshop.isActive()) return true;
        // Block while this workshop already has a client-tracked build.
        return this.byUnitId.has(this.workshop.id()) || this.hasPendingFor(this.workshop);
      },
      tooltipKeys: [
        {
          key: PRODUCT_I18N[product],
          className: "",
        },
        {
          key: "chess.factory_build_time",
          className: "cost",
          params: {
            seconds: CHESS_FACTORY_BUILD_TICKS[product] / 10,
          },
        },
      ],
      action: () => {
        if (!this.workshop) return;
        this.emitBuild(this.workshop, product);
        this.hide();
      },
    }));
  }

  private hasPendingFor(unit: UnitView): boolean {
    const c = tileToCell(this.game, unit.tile());
    return this.pending.some(
      (p) => p.workshopUnitId === unit.id() || (p.destCx === c.cx && p.destCy === c.cy),
    );
  }

  private emitBuild(unit: UnitView, product: ChessFactoryProduct) {
    const tick = this.game.ticks();
    const totalTicks = CHESS_FACTORY_BUILD_TICKS[product];
    const cell = tileToCell(this.game, unit.tile());
    const adjacentAtStart = this.countAdjacentPieces(cell.cx, cell.cy);
    this.pending.push({
      destCx: cell.cx,
      destCy: cell.cy,
      readyTick: tick + totalTicks,
      totalTicks,
      workshopUnitId: unit.id(),
    });
    this.byUnitId.set(unit.id(), {
      readyTick: tick + totalTicks,
      totalTicks,
      holding: false,
      adjacentAtStart,
    });
    this.eventBus.emit(new ChessFactoryBuildIntentEvent(unit.id(), product));
  }

  private countAdjacentPieces(cx: number, cy: number): number {
    const me = this.game.myPlayer();
    if (!me) return 0;
    let n = 0;
    for (const u of me.units()) {
      if (!u.isActive()) continue;
      const c = tileToCell(this.game, u.tile());
      const dx = Math.abs(c.cx - cx);
      const dy = Math.abs(c.cy - cy);
      if (Math.max(dx, dy) === 1) n++;
    }
    return n;
  }

  /** Call when a Workshop moves so the build pie is cleared client-side. */
  cancelBuildForUnit(unitId: number) {
    this.byUnitId.delete(unitId);
    this.pending = this.pending.filter((p) => p.workshopUnitId !== unitId);
  }

  private syncBuilds(tick: number) {
    const me = this.game.myPlayer();
    if (!me) {
      this.pending = [];
      this.byUnitId.clear();
      return;
    }

    const still: PendingBuild[] = [];
    for (const p of this.pending) {
      if (p.readyTick <= tick) continue;
      const unit = me.units(UnitType.Workshop).find((u) => {
        if (!u.isActive()) return false;
        const c = tileToCell(this.game, u.tile());
        return c.cx === p.destCx && c.cy === p.destCy;
      });
      if (unit) {
        const prev = this.byUnitId.get(unit.id());
        this.byUnitId.set(unit.id(), {
          readyTick: p.readyTick,
          totalTicks: p.totalTicks,
          holding: false,
          adjacentAtStart: prev?.adjacentAtStart ?? this.countAdjacentPieces(p.destCx, p.destCy),
        });
      } else {
        still.push(p);
      }
    }
    this.pending = still;

    for (const [id, b] of [...this.byUnitId.entries()]) {
      const live = me.units().find((u) => u.id() === id && u.isActive());
      if (!live || live.type() !== UnitType.Workshop) {
        this.byUnitId.delete(id);
        continue;
      }
      const cell = tileToCell(this.game, live.tile());
      if (tick < b.readyTick) continue;

      // Ready: deposit when space exists; otherwise hold.
      const adjacentNow = this.countAdjacentPieces(cell.cx, cell.cy);
      if (adjacentNow > b.adjacentAtStart) {
        // Piece was deposited.
        this.byUnitId.delete(id);
        continue;
      }
      if (workshopHasOpenNeighbor(this.game, cell.cx, cell.cy)) {
        // Sim deposits this tick; clear next pass or now.
        // If still no count bump, keep holding one more tick then clear.
        if (b.holding && adjacentNow === b.adjacentAtStart) {
          // Space opened; expect deposit — clear after brief hold of the flag.
          this.byUnitId.delete(id);
          continue;
        }
      }
      this.byUnitId.set(id, { ...b, holding: true });
    }
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
    this.renderBuildPies();
  }

  private ensureOverlay() {
    if (this.overlayRoot) return;
    const el = document.createElement("div");
    el.id = "chess-factory-overlay";
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "41";
    document.body.appendChild(el);
    this.overlayRoot = el;
  }

  private renderBuildPies() {
    this.ensureOverlay();
    if (!this.overlayRoot) return;
    this.overlayRoot.innerHTML = "";
    this.lastCameraKey = this.cameraKey();

    const me = this.game.myPlayer();
    if (!me) return;
    const tick = this.game.ticks();

    for (const u of me.units(UnitType.Workshop)) {
      if (!u.isActive()) continue;
      const b = this.byUnitId.get(u.id());
      if (!b || b.totalTicks <= 0) continue;
      const cell = tileToCell(this.game, u.tile());
      if (b.holding || tick >= b.readyTick) {
        // Full amber while holding a finished piece waiting for space.
        this.paintPie(cell.cx, cell.cy, 1);
        continue;
      }
      const frac = Math.min(1, Math.max(0, (b.readyTick - tick) / b.totalTicks));
      if (frac <= 0) continue;
      this.paintPie(cell.cx, cell.cy, frac);
    }
  }

  private paintPie(cx: number, cy: number, remainingFraction: number) {
    if (!this.overlayRoot) return;
    const x0 = cx * CHESS_CELL;
    const y0 = cy * CHESS_CELL;
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
    const size = Math.min(width, height) * 0.8;
    const pie = document.createElement("div");
    pie.style.position = "absolute";
    pie.style.left = `${left + (width - size) / 2}px`;
    pie.style.top = `${top + (height - size) / 2}px`;
    pie.style.width = `${size}px`;
    pie.style.height = `${size}px`;
    pie.style.borderRadius = "50%";
    pie.style.pointerEvents = "none";
    const deg = remainingFraction * 360;
    // Amber build pie (distinct from blue move CD).
    pie.style.background = `conic-gradient(rgba(180,120,20,0.6) 0deg ${deg}deg, transparent ${deg}deg 360deg)`;
    this.overlayRoot.appendChild(pie);
  }

  private hide() {
    this.radialMenu.hideRadialMenu();
    this.workshop = null;
  }
}
