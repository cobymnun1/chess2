import { Game, Player, Unit, UnitType } from "../game/Game";
import {
  ChessFactoryProduct,
  ChessPieceUnitType,
  isChessPieceType,
} from "./ChessConstants";
import { cellCenterTile, tileToCell, tilesInCell } from "./ChessMoves";

export interface ChessPieceRecord {
  pieceId: number;
  unitType: ChessPieceUnitType;
  unitId: number;
  cx: number;
  cy: number;
}

export interface ChessFactoryBuildState {
  productType: ChessFactoryProduct;
  readyTick: number;
  startTick: number;
}

type PlayerArmy = Map<number, ChessPieceRecord>;

/** Stable piece armies keyed by player id. Survives unit delete/rebuild. */
const armies = new Map<string, PlayerArmy>();

/** Cooldown keyed by playerId:pieceId (unit ids change on teleport). */
const lastMoveTickByPiece = new Map<string, number>();

/** In-progress Workshop builds keyed by playerId:pieceId. */
const factoryBuilds = new Map<string, ChessFactoryBuildState>();

function getArmy(playerId: string): PlayerArmy {
  let army = armies.get(playerId);
  if (!army) {
    army = new Map();
    armies.set(playerId, army);
  }
  return army;
}

function pieceCooldownKey(playerId: string, pieceId: number): string {
  return `${playerId}:${pieceId}`;
}

export function clearChessArmy(playerId: string): void {
  armies.delete(playerId);
  const prefix = `${playerId}:`;
  for (const k of [...lastMoveTickByPiece.keys()]) {
    if (k.startsWith(prefix)) lastMoveTickByPiece.delete(k);
  }
  for (const k of [...factoryBuilds.keys()]) {
    if (k.startsWith(prefix)) factoryBuilds.delete(k);
  }
}

export function registerChessPiece(
  playerId: string,
  record: ChessPieceRecord,
): void {
  getArmy(playerId).set(record.pieceId, { ...record });
}

export function unregisterChessPiece(
  playerId: string,
  pieceId: number,
): void {
  getArmy(playerId).delete(pieceId);
  factoryBuilds.delete(pieceCooldownKey(playerId, pieceId));
}

export function getChessPieceByUnitId(
  playerId: string,
  unitId: number,
): ChessPieceRecord | undefined {
  for (const rec of getArmy(playerId).values()) {
    if (rec.unitId === unitId) return rec;
  }
  return undefined;
}

export function getChessPieceById(
  playerId: string,
  pieceId: number,
): ChessPieceRecord | undefined {
  return getArmy(playerId).get(pieceId);
}

export function updateChessPieceAfterTeleport(
  playerId: string,
  pieceId: number,
  unitId: number,
  cx: number,
  cy: number,
): void {
  const rec = getArmy(playerId).get(pieceId);
  if (!rec) return;
  rec.unitId = unitId;
  rec.cx = cx;
  rec.cy = cy;
}

export function setChessPieceMoveTick(
  playerId: string,
  pieceId: number,
  tick: number,
): void {
  lastMoveTickByPiece.set(pieceCooldownKey(playerId, pieceId), tick);
}

export function chessPieceIdCooldownRemaining(
  playerId: string,
  pieceId: number,
  cooldownTicks: number,
  currentTick: number,
): number {
  const last =
    lastMoveTickByPiece.get(pieceCooldownKey(playerId, pieceId)) ?? -Infinity;
  return Math.max(0, last + cooldownTicks - currentTick);
}

export function startChessFactoryBuild(
  playerId: string,
  pieceId: number,
  productType: ChessFactoryProduct,
  startTick: number,
  readyTick: number,
): void {
  factoryBuilds.set(pieceCooldownKey(playerId, pieceId), {
    productType,
    startTick,
    readyTick,
  });
}

export function getChessFactoryBuild(
  playerId: string,
  pieceId: number,
): ChessFactoryBuildState | undefined {
  return factoryBuilds.get(pieceCooldownKey(playerId, pieceId));
}

export function cancelChessFactoryBuild(
  playerId: string,
  pieceId: number,
): void {
  factoryBuilds.delete(pieceCooldownKey(playerId, pieceId));
}

export function listChessPieces(playerId: string): ChessPieceRecord[] {
  return Array.from(getArmy(playerId).values());
}

/**
 * Ensure every registered piece has a live unit of the right type at its cell.
 * Rebuilds missing pieces (gold refunded). Returns true if army was already OK.
 */
export function verifyAndRepairChessArmy(
  mg: Game,
  player: Player,
  attachBehavior: (type: UnitType, unit: Unit) => void,
): boolean {
  const playerId = player.id();
  const army = getArmy(playerId);
  let ok = true;

  for (const rec of army.values()) {
    const unit = player
      .units()
      .find((u) => u.id() === rec.unitId && u.isActive());

    const cellOk =
      unit &&
      (() => {
        const c = tileToCell(mg, unit.tile());
        return c.cx === rec.cx && c.cy === rec.cy;
      })();

    if (unit && unit.type() === rec.unitType && cellOk) {
      continue;
    }

    ok = false;
    console.warn(
      `ChessPieceRegistry: repairing piece ${rec.pieceId} (${rec.unitType}) for ${playerId}`,
    );

    unit?.delete(false);

    for (const t of tilesInCell(mg, rec.cx, rec.cy)) {
      if (mg.owner(t) !== player) player.conquer(t);
    }
    const tile = cellCenterTile(mg, rec.cx, rec.cy);
    const cost = mg.unitInfo(rec.unitType).cost(mg, player);
    player.addGold(cost);
    const rebuilt = player.buildUnit(rec.unitType, tile, {});
    attachBehavior(rec.unitType, rebuilt);
    rec.unitId = rebuilt.id();
  }

  for (const [id, rec] of [...army.entries()]) {
    if (!isChessPieceType(rec.unitType)) {
      army.delete(id);
      ok = false;
    }
  }

  return ok;
}
