import type { GameState, Piece, Player } from '../engine/types';
import type { CpuAction, Placement } from './types';
import { boardConfig } from '../config/boardConfig';
import { getCellKind, isPassable } from '../engine/board';
import { canPassMines, getActualRange, getNominalRange } from '../engine/pieces';
import {
  attackPiece,
  confirmHandoff,
  endTurn,
  liftMine,
  movePiece,
  placeMine,
  placePieceInSetup,
  reconPiece,
  selectNumberToken,
} from '../engine/gameEngine';

export const BOARD_ROWS = boardConfig.rows;
export const BOARD_COLS = boardConfig.cols;
const NCELLS = BOARD_ROWS * BOARD_COLS;

/** Indice lineal (0-based) de la celda (r, c) con r en 1..20 y c en 1..24. */
export function cellIdx(r: number, c: number): number {
  return (r - 1) * BOARD_COLS + (c - 1);
}

export function inBoard(r: number, c: number): boolean {
  return r >= 1 && r <= BOARD_ROWS && c >= 1 && c <= BOARD_COLS;
}

export const ISLAND_GRID = new Uint8Array(NCELLS);
export const SEA_GRID = new Uint8Array(NCELLS);
export const PASSABLE_GRID = new Uint8Array(NCELLS);
for (let r = 1; r <= BOARD_ROWS; r++) {
  for (let c = 1; c <= BOARD_COLS; c++) {
    const i = cellIdx(r, c);
    const kind = getCellKind(r, c);
    if (kind === 'island') ISLAND_GRID[i] = 1;
    if (kind === 'sea') SEA_GRID[i] = 1;
    if (isPassable(r, c)) PASSABLE_GRID[i] = 1;
  }
}

export const DIRS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Llena buf con el indice (en pieces) de la pieza viva que ocupa cada celda, o -1. */
export function fillOccupancy(buf: Int16Array, pieces: readonly Piece[]): void {
  buf.fill(-1);
  for (let i = 0; i < pieces.length; i++) {
    const pos = pieces[i].pos;
    if (pos) buf[cellIdx(pos.r, pos.c)] = i;
  }
}

// ─── Memoria de turno (acotar minas) ─────────────────────────────────────────

/**
 * placeMine/liftMine no consumen presupuesto ni tienen limite en el motor. Para garantizar
 * que un turno termina, se permite UNA sola accion de mina (poner o levantar) por turno.
 * El conteo se deriva del tramo final de state.log (desde el ultimo cambio de turno).
 */
export interface TurnMemo {
  mineActions: number;
}

export const EMPTY_MEMO: TurnMemo = Object.freeze({ mineActions: 0 });
export const MAX_MINE_ACTIONS_PER_TURN = 1;

const MINE_LINE = /^M \([AB]\) (?:coloca|levanta) mina/;
const TURN_BOUNDARY = /entrega ficha|Setup completado/;

export function deriveTurnMemo(state: { log: readonly string[] }): TurnMemo {
  const log = state.log;
  let n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const line = log[i];
    if (TURN_BOUNDARY.test(line)) break;
    if (MINE_LINE.test(line)) n++;
  }
  return n === 0 ? EMPTY_MEMO : { mineActions: n };
}

/** Lineas de log sinteticas que reproducen una memoria (para mundos de simulacion). */
export function memoToLog(memo: TurnMemo, turn: Player): string[] {
  const out: string[] = [];
  for (let i = 0; i < memo.mineActions; i++) out.push(`M (${turn}) coloca mina en (0,0)`);
  return out;
}

// ─── Aplicar acciones ────────────────────────────────────────────────────────

export function applyCpuAction(state: GameState, a: CpuAction): GameState | string {
  switch (a.kind) {
    case 'selectToken':
      return selectNumberToken(state, a.token);
    case 'move':
      return movePiece(state, a.pieceId, a.to);
    case 'attack':
      return attackPiece(state, a.attackerId, a.targetId);
    case 'recon':
      return reconPiece(state, a.pieceId, a.targetId);
    case 'placeMine':
      return placeMine(state, a.pieceId, a.at);
    case 'liftMine':
      return liftMine(state, a.pieceId, a.at);
    case 'endTurn':
      return endTurn(state);
  }
}

/**
 * Variante para simular: aplica la accion y, si el turno paso al rival (phase handoffPlay),
 * confirma el handoff para poder seguir. Mantiene log acotado: solo las lineas de mina del
 * turno en curso (lo que deriveTurnMemo necesita), de modo que clonar el estado es barato.
 * Para juego real usar applyCpuAction + confirmHandoff y conservar el log completo.
 */
export function applyAndAdvance(state: GameState, a: CpuAction): GameState | string {
  const next = applyCpuAction(state, a);
  if (typeof next === 'string') return next;
  const log =
    a.kind === 'placeMine' || a.kind === 'liftMine' ? next.log : a.kind === 'endTurn' ? [] : state.log;
  const adv = next.phase === 'handoffPlay' ? confirmHandoff(next) : next;
  return log === adv.log ? adv : { ...adv, log };
}

export function applyPlacements(state: GameState, placements: readonly Placement[]): GameState | string {
  let cur = state;
  for (const p of placements) {
    const next = placePieceInSetup(cur, p.pieceId, p.pos);
    if (typeof next === 'string') return next;
    cur = next;
  }
  return cur;
}

export function actionKey(a: CpuAction): string {
  switch (a.kind) {
    case 'selectToken':
      return `t${a.token}`;
    case 'move':
      return `m${a.pieceId}>${a.to.r},${a.to.c}`;
    case 'attack':
      return `a${a.attackerId}>${a.targetId}`;
    case 'recon':
      return `r${a.pieceId}>${a.targetId}`;
    case 'placeMine':
      return `p${a.pieceId}@${a.at.r},${a.at.c}`;
    case 'liftMine':
      return `l${a.pieceId}@${a.at.r},${a.at.c}`;
    case 'endTurn':
      return 'e';
  }
}

// ─── Enumeracion de acciones legales ─────────────────────────────────────────

export interface EnumerateOptions {
  /**
   * true (por defecto): cada candidato se confirma con el motor y se descarta si devuelve string.
   * false: solo prefiltros geometricos (identico resultado, ~10x mas rapido); para rollouts.
   */
  verify?: boolean;
}

const OCC = new Int16Array(NCELLS);
const MINE = new Uint8Array(NCELLS);

/**
 * Todas las acciones legales del subturno actual de `me` (phase play y state.turn === me).
 * Si aun no hay ficha elegida: solo selectToken. Si no: movimientos de a una celda, ataques,
 * reconocimientos, minas (a lo sumo MAX_MINE_ACTIONS_PER_TURN por turno, segun `memo`) y endTurn.
 * Orden estable: depende solo de posiciones/ids, nunca de tipos enemigos.
 */
export function enumerateActions(
  state: GameState,
  me: Player,
  memo: TurnMemo = deriveTurnMemo(state),
  opts: EnumerateOptions = {},
): CpuAction[] {
  if (state.phase !== 'play' || state.turn !== me) return [];
  const verify = opts.verify !== false;
  const out: CpuAction[] = [];

  const token = state.selectedNumberToken;
  if (token === null) {
    let prev = -1;
    for (const t of [...state.numberTokens[me]].sort((a, b) => a - b)) {
      if (t === prev) continue;
      prev = t;
      out.push({ kind: 'selectToken', token: t });
    }
    return verify ? out.filter(a => typeof applyCpuAction(state, a) !== 'string') : out;
  }

  const pieces = state.pieces;
  fillOccupancy(OCC, pieces);
  MINE.fill(0);
  let ownMines = 0;
  for (const m of state.mines) {
    if (inBoard(m.r, m.c)) MINE[cellIdx(m.r, m.c)] = 1;
    if (m.owner === me) ownMines++;
  }

  const budget = token - state.movementBudgetSpent;
  const canAttack = !state.attackOrReconUsedThisTurn;
  const advancedRange = state.options.advancedActualRange;
  const mineBudget = memo.mineActions < MAX_MINE_ACTIONS_PER_TURN;

  for (const p of pieces) {
    if (p.owner !== me || !p.pos) continue;
    const { r, c } = p.pos;

    const stepCost = p.damaged ? 2 : 1;
    if (budget >= stepCost) {
      const passesMines = canPassMines(p.type);
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        const i = cellIdx(nr, nc);
        if (!PASSABLE_GRID[i] || OCC[i] !== -1) continue;
        if (MINE[i] && !passesMines) continue;
        out.push({ kind: 'move', pieceId: p.id, to: { r: nr, c: nc } });
      }
    }

    if (canAttack && p.type !== 'AvionReconocimiento') {
      if (p.type === 'AvionCombate' && (state.movementBudgetSpent > 0 || state.combatPlaneAttackUsedThisTurn)) continue;
      const range = advancedRange ? getActualRange(p) : getNominalRange(p.type);
      scanRays(r, c, Math.min(range, BOARD_COLS), me, pieces, (target) => {
        out.push({ kind: 'attack', attackerId: p.id, targetId: target.id });
      });
    } else if (canAttack) {
      scanRays(r, c, BOARD_COLS, me, pieces, (target) => {
        out.push({ kind: 'recon', pieceId: p.id, targetId: target.id });
      });
    }
  }

  if (mineBudget) {
    for (const p of pieces) {
      if (p.owner !== me || !p.pos || p.type !== 'Minador') continue;
      for (const [dr, dc] of DIRS) {
        const nr = p.pos.r + dr;
        const nc = p.pos.c + dc;
        if (!inBoard(nr, nc)) continue;
        const i = cellIdx(nr, nc);
        if (MINE[i]) out.push({ kind: 'liftMine', pieceId: p.id, at: { r: nr, c: nc } });
        else if (SEA_GRID[i] && OCC[i] === -1 && ownMines < 15) {
          out.push({ kind: 'placeMine', pieceId: p.id, at: { r: nr, c: nc } });
        }
      }
    }
  }

  out.push({ kind: 'endTurn' });
  return verify ? out.filter(a => typeof applyCpuAction(state, a) !== 'string') : out;
}

/** Desde (r, c), en cada direccion ortogonal, la primera pieza enemiga visible a <= maxSteps celdas. */
function scanRays(
  r: number,
  c: number,
  maxSteps: number,
  me: Player,
  pieces: readonly Piece[],
  onTarget: (target: Piece) => void,
): void {
  for (const [dr, dc] of DIRS) {
    for (let step = 1; step <= maxSteps; step++) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!inBoard(nr, nc)) break;
      const i = cellIdx(nr, nc);
      if (ISLAND_GRID[i]) break;
      const j = OCC[i];
      if (j !== -1) {
        if (pieces[j].owner !== me) onTarget(pieces[j]);
        break;
      }
    }
  }
}
