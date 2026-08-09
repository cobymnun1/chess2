import {
  CHESS_FACTORY_BUILD_TICKS,
  ChessFactoryProduct,
  isChessFactoryProduct,
  isChessPieceType,
} from "../chess/ChessConstants";
import {
  cellCenterTile,
  findFactoryDepositCell,
  tilesInCell,
  workshopHasOpenNeighbor,
} from "../chess/ChessMoves";
import {
  cancelChessFactoryBuild,
  getChessFactoryBuild,
  getChessPieceById,
  getChessPieceByUnitId,
  listChessPieces,
  registerChessPiece,
  startChessFactoryBuild,
} from "../chess/ChessPieceRegistry";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { attachChessPieceBehavior } from "./ChessSetupExecution";

/**
 * Starts a Workshop production build and deposits when ready.
 * If no adjacent empty cell at ready time, keeps the finished piece held in
 * the workshop until a neighbor opens (workshop stays busy; no new builds).
 * Move cancels via registry clear in ChessMoveExecution.
 */
export class ChessFactoryBuildExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private pieceId = -1;
  private product: ChessFactoryProduct | null = null;
  private readyTick = -1;
  private nextPieceId = -1;

  constructor(
    private readonly owner: Player,
    private readonly unitId: number,
    private readonly productType: UnitType,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (!isChessFactoryProduct(this.productType)) {
      console.warn(
        `ChessFactoryBuildExecution: invalid product ${this.productType}`,
      );
      this.active = false;
      return;
    }
    this.product = this.productType;

    const playerId = this.owner.id();
    const rec = getChessPieceByUnitId(playerId, this.unitId);
    if (!rec || rec.unitType !== UnitType.Workshop) {
      console.warn(
        `ChessFactoryBuildExecution: unit ${this.unitId} is not a Workshop`,
      );
      this.active = false;
      return;
    }

    const unit = this.owner
      .units()
      .find((u) => u.id() === rec.unitId && u.isActive());
    if (!unit || unit.type() !== UnitType.Workshop) {
      this.active = false;
      return;
    }

    if (getChessFactoryBuild(playerId, rec.pieceId)) {
      this.active = false;
      return;
    }

    // Need somewhere to eventually put the piece (or already open).
    if (!workshopHasOpenNeighbor(mg, rec.cx, rec.cy)) {
      console.warn(
        `ChessFactoryBuildExecution: no open neighbor for workshop ${rec.pieceId}`,
      );
      this.active = false;
      return;
    }

    const duration = CHESS_FACTORY_BUILD_TICKS[this.product];
    this.pieceId = rec.pieceId;
    this.readyTick = ticks + duration;
    this.nextPieceId =
      listChessPieces(playerId).reduce((m, p) => Math.max(m, p.pieceId), 0) + 1;

    startChessFactoryBuild(
      playerId,
      rec.pieceId,
      this.product,
      ticks,
      this.readyTick,
    );
  }

  tick(ticks: number): void {
    if (!this.active || !this.mg || this.product === null || this.pieceId < 0) {
      this.active = false;
      return;
    }

    const playerId = this.owner.id();
    const build = getChessFactoryBuild(playerId, this.pieceId);
    if (!build) {
      // Cancelled (e.g. workshop moved).
      this.active = false;
      return;
    }

    if (ticks < this.readyTick) return;

    const rec = getChessPieceById(playerId, this.pieceId);
    if (!rec || rec.unitType !== UnitType.Workshop) {
      cancelChessFactoryBuild(playerId, this.pieceId);
      this.active = false;
      return;
    }

    const deposit = findFactoryDepositCell(this.mg, rec.cx, rec.cy);
    if (!deposit) {
      // Hold finished piece in the workshop until a neighbor opens.
      return;
    }

    for (const t of tilesInCell(this.mg, deposit.cx, deposit.cy)) {
      if (this.mg.owner(t) !== this.owner) {
        this.owner.conquer(t);
      }
    }

    const product = this.product;
    const cost = this.mg.unitInfo(product).cost(this.mg, this.owner);
    this.owner.addGold(cost);
    const built = this.owner.buildUnit(
      product,
      cellCenterTile(this.mg, deposit.cx, deposit.cy),
      {},
    );
    attachChessPieceBehavior(this.mg, this.owner, product, built);

    if (isChessPieceType(product)) {
      registerChessPiece(playerId, {
        pieceId: this.nextPieceId,
        unitType: product,
        unitId: built.id(),
        cx: deposit.cx,
        cy: deposit.cy,
      });
    }

    cancelChessFactoryBuild(playerId, this.pieceId);
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
