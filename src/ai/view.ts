import type { GameState, Piece, Player, UnitType } from '../engine/types';
import type { Cell, CpuAction, CpuLevel } from './types';
import { canSeeIdentity } from '../engine/gameEngine';
import { createFleet } from '../engine/pieces';
import { deriveTurnMemo, memoToLog, type TurnMemo } from './actions';
import { finishHash, mixHash, HASH_SEED, type Rng } from './rng';

/**
 * Pieza tal como la ve un jugador: el tipo de las piezas enemigas que no puede identificar
 * (canSeeIdentity falso) es null y su id es opaco (nunca interpretar ids). Posiciones, dueño,
 * averia y revealedTo se ven siempre.
 */
export interface ViewPiece {
  id: string;
  owner: Player;
  type: UnitType | null;
  pos: Cell | null;
  damaged: boolean;
  revealedTo: Player[];
}

/**
 * Vista enmascarada del estado para `me`: es TODO lo que un nivel puede mirar.
 * Contiene los mismos campos publicos de GameState (turn, phase, fichas, minas, flags de turno,
 * options, winner, setup...) salvo `pieces` (enmascaradas) y `log` (puede nombrar tipos enemigos).
 */
export interface PlayerView extends Omit<GameState, 'pieces' | 'log'> {
  me: Player;
  opp: Player;
  pieces: ViewPiece[];
  /** Acciones de mina ya gastadas en el turno en curso (derivado del log real). */
  memo: TurnMemo;
  /** Ids (opacos, '?B0'...) de piezas enemigas con tipo desconocido, vivas o destruidas sin identificar. */
  hiddenIds: string[];
  /** Multiconjunto de tipos que esas piezas ocultas tienen (misma longitud que hiddenIds). */
  unknownPool: UnitType[];
}

export interface LevelContext {
  view: PlayerView;
  me: Player;
  /** Acciones legales del subturno actual (enumerateActions, con ids de la vista); nunca vacia; la salida debe estar aca. */
  legal: CpuAction[];
  rng: () => number;
  iterations?: number;
  timeBudgetMs?: number;
}

export interface SetupContext {
  view: PlayerView;
  me: Player;
  level: CpuLevel;
  rng: () => number;
  iterations?: number;
  timeBudgetMs?: number;
}

export function otherPlayer(p: Player): Player {
  return p === 'A' ? 'B' : 'A';
}

export const UNIT_TYPES: readonly UnitType[] = [
  'Acorazado',
  'Crucero',
  'Fragata',
  'Minador',
  'Submarino',
  'AvionCombate',
  'AvionReconocimiento',
];

/** Cuantas piezas de cada tipo tiene una flota (16 en total). */
export const FLEET_COUNTS: Readonly<Record<UnitType, number>> = (() => {
  const counts = Object.fromEntries(UNIT_TYPES.map(t => [t, 0])) as Record<UnitType, number>;
  for (const p of createFleet('A')) counts[p.type]++;
  return counts;
})();

/** Traduce ids entre el estado real y la vista (los ids de piezas enemigas ocultas son opacos en la vista). */
export interface IdMap {
  toReal(viewId: string): string;
  toView(realId: string): string;
  realAction(a: CpuAction): CpuAction;
  viewAction(a: CpuAction): CpuAction;
}

function mapActionIds(a: CpuAction, f: (id: string) => string): CpuAction {
  switch (a.kind) {
    case 'move':
      return { kind: 'move', pieceId: f(a.pieceId), to: a.to };
    case 'attack':
      return { kind: 'attack', attackerId: f(a.attackerId), targetId: f(a.targetId) };
    case 'recon':
      return { kind: 'recon', pieceId: f(a.pieceId), targetId: f(a.targetId) };
    case 'placeMine':
      return { kind: 'placeMine', pieceId: f(a.pieceId), at: a.at };
    case 'liftMine':
      return { kind: 'liftMine', pieceId: f(a.pieceId), at: a.at };
    default:
      return a;
  }
}

function makeIdMap(viewToReal: Map<string, string>, realToView: Map<string, string>): IdMap {
  const toReal = (id: string) => viewToReal.get(id) ?? id;
  const toView = (id: string) => realToView.get(id) ?? id;
  return {
    toReal,
    toView,
    realAction: a => mapActionIds(a, toReal),
    viewAction: a => mapActionIds(a, toView),
  };
}

export interface MaskedState {
  view: PlayerView;
  ids: IdMap;
}

/**
 * Los ids reales codifican el tipo ('B-Acorazado-0') y el orden del arreglo sigue al de la flota,
 * asi que para una pieza enemiga oculta ambos filtrarian el tipo. En la vista esas piezas llevan
 * ids opacos '?B0', '?B1'... asignados por posicion (fila, columna; las destruidas al final) y van
 * al final del arreglo. Todo lo demas conserva id y orden. `ids` traduce acciones de ida y vuelta.
 */
export function maskState(state: GameState, me: Player): MaskedState {
  const opp = otherPlayer(me);
  const { pieces, log, ...rest } = state;

  const shown: Piece[] = [];
  const hiddenAlive: Piece[] = [];
  const hiddenDead: Piece[] = [];
  const remaining: Record<UnitType, number> = { ...FLEET_COUNTS };
  const mineIds = new Set<string>();
  for (const p of pieces) {
    if (p.owner === me) mineIds.add(p.id);
    if (p.owner === opp && !canSeeIdentity(p, me)) (p.pos ? hiddenAlive : hiddenDead).push(p);
    else {
      shown.push(p);
      if (p.owner === opp) remaining[p.type]--;
    }
  }
  hiddenAlive.sort((a, b) => a.pos!.r - b.pos!.r || a.pos!.c - b.pos!.c);
  const hidden = [...hiddenAlive, ...hiddenDead];

  const viewToReal = new Map<string, string>();
  const realToView = new Map<string, string>();
  const hiddenIds: string[] = [];
  const viewPieces: ViewPiece[] = shown.map(p => ({
    id: p.id,
    owner: p.owner,
    type: p.type,
    pos: p.pos,
    damaged: p.damaged,
    revealedTo: p.revealedTo,
  }));
  hidden.forEach((p, i) => {
    const id = `?${opp}${i}`;
    viewToReal.set(id, p.id);
    realToView.set(p.id, id);
    hiddenIds.push(id);
    viewPieces.push({ id, owner: opp, type: null, pos: p.pos, damaged: false, revealedTo: [] });
  });

  const unknownPool: UnitType[] = [];
  for (const t of UNIT_TYPES) for (let i = 0; i < remaining[t]; i++) unknownPool.push(t);

  const view: PlayerView = {
    ...rest,
    setupPlacedPieceIds: rest.setupPlacedPieceIds.filter(id => mineIds.has(id)),
    me,
    opp,
    pieces: viewPieces,
    memo: deriveTurnMemo({ log }),
    hiddenIds,
    unknownPool,
  };
  return { view, ids: makeIdMap(viewToReal, realToView) };
}

export function maskedView(state: GameState, me: Player): PlayerView {
  return maskState(state, me).view;
}

/** Copia del estado con el tipo de las piezas enemigas ocultas reemplazado por un valor fijo. */
export function maskHiddenTypes(state: GameState, me: Player): GameState {
  let changed = false;
  const pieces = state.pieces.map(p => {
    if (p.owner === me || canSeeIdentity(p, me) || p.type === 'Fragata') return p;
    changed = true;
    return { ...p, type: 'Fragata' as const };
  });
  return changed ? { ...state, pieces } : state;
}

export interface DeterminizeOptions {
  /** Tipos permitidos por id de pieza oculta (p. ej. deducidos de su historial); se respetan si es posible. */
  allowed?: Readonly<Record<string, readonly UnitType[]>>;
}

/**
 * Mundo completo y consistente con lo que `view` sabe: cada pieza oculta recibe un tipo del
 * unknownPool (muestreo uniforme sin reposicion), asi la composicion de flota se conserva.
 * Lo visible queda intacto. El log lleva solo las lineas de mina del turno (la memoria), no el
 * historial. Muta nada de `view`.
 */
export function determinize(view: PlayerView, rng: Rng, opts: DeterminizeOptions = {}): GameState {
  const hidden = view.hiddenIds;
  const assigned = new Map<string, UnitType>();

  if (hidden.length > 0) {
    const pool = view.unknownPool.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }

    const allowed = opts.allowed;
    const free: string[] = [];
    if (allowed) {
      // Primero las mas restringidas, tomando el primer tipo compatible del pool barajado.
      const constrained = hidden
        .filter(id => allowed[id] !== undefined)
        .sort((a, b) => allowed[a].length - allowed[b].length);
      for (const id of constrained) {
        const k = pool.findIndex(t => allowed[id].includes(t));
        if (k === -1) free.push(id);
        else assigned.set(id, pool.splice(k, 1)[0]);
      }
      for (const id of hidden) if (allowed[id] === undefined) free.push(id);
    } else {
      for (const id of hidden) free.push(id);
    }
    for (const id of free) assigned.set(id, pool.pop() as UnitType);
  }

  const pieces: Piece[] = view.pieces.map(p => ({
    id: p.id,
    owner: p.owner,
    type: p.type ?? (assigned.get(p.id) as UnitType),
    pos: p.pos,
    damaged: p.damaged,
    revealedTo: p.revealedTo,
  }));

  return {
    pieces,
    log: memoToLog(view.memo, view.turn),
    mines: view.mines,
    turn: view.turn,
    numberTokens: view.numberTokens,
    phase: view.phase,
    setupPlayer: view.setupPlayer,
    combatPlaneAttackUsedThisTurn: view.combatPlaneAttackUsedThisTurn,
    attackOrReconUsedThisTurn: view.attackOrReconUsedThisTurn,
    movementBudgetSpent: view.movementBudgetSpent,
    selectedNumberToken: view.selectedNumberToken,
    options: view.options,
    winner: view.winner,
    setupPlacedPieceIds: view.setupPlacedPieceIds,
  };
}

/** Distribucion de tipos de una pieza segun lo que se sabe: delta si es visible, uniforme sobre el pool si no. */
export function typeProbs(view: PlayerView, pieceId: string): [UnitType, number][] {
  const piece = view.pieces.find(p => p.id === pieceId);
  if (!piece) return [];
  if (piece.type) return [[piece.type, 1]];
  const total = view.unknownPool.length;
  if (total === 0) return [];
  const counts = new Map<UnitType, number>();
  for (const t of view.unknownPool) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([t, n]) => [t, n / total]);
}

/** Hash de 32 bits de lo que `view` sabe (nunca depende de tipos ocultos). Util como semilla por defecto. */
export function hashView(view: PlayerView): number {
  let h = HASH_SEED;
  h = mixHash(h, view.me === 'A' ? 1 : 2);
  h = mixHash(h, view.turn === 'A' ? 1 : 2);
  h = mixHash(h, view.selectedNumberToken ?? 0);
  h = mixHash(h, view.movementBudgetSpent);
  h = mixHash(h, (view.attackOrReconUsedThisTurn ? 1 : 0) | (view.combatPlaneAttackUsedThisTurn ? 2 : 0));
  h = mixHash(h, view.memo.mineActions);
  for (const t of view.numberTokens.A) h = mixHash(h, t);
  h = mixHash(h, -1);
  for (const t of view.numberTokens.B) h = mixHash(h, t);
  for (const p of view.pieces) {
    h = mixHash(h, p.pos ? p.pos.r * 64 + p.pos.c : 0);
    h = mixHash(h, (p.damaged ? 1 : 0) | (p.type ? 2 : 0));
    if (p.type) h = mixHash(h, UNIT_TYPES.indexOf(p.type));
  }
  for (const m of view.mines) h = mixHash(h, m.r * 64 + m.c + (m.owner === 'A' ? 4096 : 0));
  return finishHash(h);
}
