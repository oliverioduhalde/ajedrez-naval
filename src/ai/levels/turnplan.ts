import type { CombatResult, GameState, Piece, Player } from '../../engine/types';
import { isFatalResult, resolveCombat } from '../../engine/combat';
import { canPassMines, getActualRange, getNominalRange } from '../../engine/pieces';
import type { Cell, CpuAction } from '../types';
import {
  BOARD_COLS,
  BOARD_ROWS,
  DIRS,
  ISLAND_GRID,
  PASSABLE_GRID,
  actionKey,
  applyAndAdvance,
  cellIdx,
  enumerateActions,
  fillOccupancy,
  inBoard,
} from '../actions';
import { EVAL_WEIGHTS, evaluate, goalDistance, materialValue } from '../evaluate';
import { HASH_SEED, finishHash, hashString, mixHash, mulberry32 } from '../rng';
import { determinize, UNIT_TYPES, type PlayerView } from '../view';

// ─── Presupuesto ─────────────────────────────────────────────────────────────

export interface PlanBudget {
  /** Mundos determinizados sobre los que se promedia el valor de cada plan. */
  worlds: number;
  /** Nodos que sobreviven en cada capa de la busqueda en haz. */
  beam: number;
  /** Candidatos por nodo que se evaluan en todos los mundos. */
  breadth: number;
  /** Con 1 se salta la preseleccion; con m > 1 se prueban m * breadth candidatos en un solo mundo. */
  prefilter: number;
  /** Planes finalistas que se vuelven a puntuar contra la mejor respuesta del rival (0 = sin respuesta). */
  finalists: number;
}

export const DEFAULT_ITERATIONS = 72;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** `iterations` escala el trabajo de la busqueda (no hay reloj: el resultado depende solo de la vista). */
export function budgetFor(iterations?: number): PlanBudget {
  const it = Math.max(1, Math.round(iterations ?? DEFAULT_ITERATIONS));
  return {
    worlds: clamp(Math.round(it / 12), 1, 12),
    beam: clamp(Math.round(it / 16), 2, 8),
    breadth: clamp(Math.round(it / 12), 3, 10),
    prefilter: it >= 48 ? 3 : 1,
    finalists: it >= 48 ? 4 : 0,
  };
}

/** Parametros de juego ajustables (no entran en el presupuesto). */
export const PLAN_TUNING = {
  /** Costo por punto de ficha entregada al rival (desempata hacia fichas bajas). */
  tokenPenalty: 0.002,
  /** Premio por revelar una pieza oculta: atacarla / reconocerla. */
  infoAttack: 0.015,
  infoRecon: 0.035,
  /** Maximo de ataques/reconocimientos que entran como candidatos en un nodo. */
  maxAttackCands: 6,
  /** Detecta (con bloqueos y minas) si el rival gana en su proximo turno y lo trata como casi derrota. */
  dangerCheck: true,
  /** Planes "mover y disparar" contra corredores rivales que se prueban a la vez que el haz. */
  stopPlans: 6,
  /** Empuje del haz hacia jugadas que dejan a una pieza en posicion de frenar a un corredor rival. */
  guide: 0.3,
  /** Cuanto pesa la mejor respuesta del rival (mover y atacar) en la puntuacion de los finalistas: 0 la ignora. */
  replyWeight: 0.6,
};

// ─── Mundos ──────────────────────────────────────────────────────────────────

/** Semilla estable durante todo mi turno: solo mira lo que el rival no mueve mientras yo juego. */
export function turnSeed(view: PlayerView): number {
  let h = HASH_SEED;
  h = mixHash(h, view.me === 'A' ? 1 : 2);
  for (const t of view.numberTokens.A) h = mixHash(h, t);
  h = mixHash(h, -1);
  for (const t of view.numberTokens.B) h = mixHash(h, t);
  for (const p of view.pieces) {
    if (p.owner === view.me) continue;
    h = mixHash(h, p.pos ? p.pos.r * 64 + p.pos.c : 0);
    h = mixHash(h, (p.damaged ? 1 : 0) | (p.type ? 2 : 0));
    if (p.type) h = mixHash(h, UNIT_TYPES.indexOf(p.type));
  }
  return finishHash(h);
}

function makeWorlds(view: PlayerView, count: number, seed: number): GameState[] {
  const rng = mulberry32(seed);
  const n = view.hiddenIds.length === 0 ? 1 : count;
  const worlds: GameState[] = [];
  for (let i = 0; i < n; i++) worlds.push(determinize(view, rng));
  return worlds;
}

// ─── Victoria inmediata ──────────────────────────────────────────────────────

const WIN_OCC = new Uint8Array(BOARD_ROWS * BOARD_COLS);
const WIN_MINE = new Uint8Array(BOARD_ROWS * BOARD_COLS);
const WIN_SEEN = new Int16Array(BOARD_ROWS * BOARD_COLS);

export interface WinPlan {
  pieceId: string;
  path: Cell[];
  cost: number;
}

/**
 * Camino mas corto de una pieza propia hasta la zona de llegada con el presupuesto `budget`.
 * Solo mira lo que el motor deja ver: posiciones, minas y tipos propios (nunca tipos ocultos).
 */
export function findWinPlan(view: PlayerView, me: Player, budget: number): WinPlan | null {
  if (budget <= 0) return null;
  WIN_OCC.fill(0);
  WIN_MINE.fill(0);
  for (const p of view.pieces) if (p.pos) WIN_OCC[cellIdx(p.pos.r, p.pos.c)] = 1;
  for (const m of view.mines) if (inBoard(m.r, m.c)) WIN_MINE[cellIdx(m.r, m.c)] = 1;

  let best: WinPlan | null = null;
  for (const p of view.pieces) {
    if (p.owner !== me || !p.pos || p.type === null) continue;
    const stepCost = p.damaged ? 2 : 1;
    const maxSteps = Math.floor(budget / stepCost);
    if (maxSteps < 1) continue;
    const passes = canPassMines(p.type);
    const start = cellIdx(p.pos.r, p.pos.c);
    WIN_SEEN.fill(-1);
    WIN_SEEN[start] = start;
    let frontier = [start];
    let found = -1;
    for (let depth = 1; depth <= maxSteps && found < 0 && frontier.length > 0; depth++) {
      const nextFrontier: number[] = [];
      for (const cur of frontier) {
        const r = Math.floor(cur / BOARD_COLS) + 1;
        const c = (cur % BOARD_COLS) + 1;
        for (const [dr, dc] of DIRS) {
          const nr = r + dr;
          const nc = c + dc;
          if (!inBoard(nr, nc)) continue;
          const i = cellIdx(nr, nc);
          if (WIN_SEEN[i] !== -1 || !PASSABLE_GRID[i] || WIN_OCC[i]) continue;
          if (WIN_MINE[i] && !passes) continue;
          WIN_SEEN[i] = cur;
          if (goalDistance(me, nr, nc) === 0) {
            found = i;
            break;
          }
          nextFrontier.push(i);
        }
        if (found >= 0) break;
      }
      frontier = nextFrontier;
    }
    if (found < 0) continue;
    const path: Cell[] = [];
    for (let i = found; i !== start; i = WIN_SEEN[i]) {
      path.push({ r: Math.floor(i / BOARD_COLS) + 1, c: (i % BOARD_COLS) + 1 });
    }
    path.reverse();
    const cost = path.length * stepCost;
    if (best === null || cost < best.cost) best = { pieceId: p.id, path, cost };
  }
  return best;
}

// ─── Victoria del rival en su proximo turno (con bloqueos y minas) ───────────

const NCELLS = BOARD_ROWS * BOARD_COLS;
const OCC_ANY = new Uint8Array(NCELLS);
const MINE_ANY = new Uint8Array(NCELLS);
const FIELD_SHIP = new Int16Array(NCELLS);
const FIELD_FLY = new Int16Array(NCELLS);
const QUEUE = new Int16Array(NCELLS);

const ARRIVAL_CELLS: Record<Player, number[]> = { A: [], B: [] };
for (let r = 1; r <= BOARD_ROWS; r++) {
  for (let c = 1; c <= BOARD_COLS; c++) {
    if (goalDistance('A', r, c) === 0) ARRIVAL_CELLS.A.push(cellIdx(r, c));
    if (goalDistance('B', r, c) === 0) ARRIVAL_CELLS.B.push(cellIdx(r, c));
  }
}

/** Pasos hasta la zona de llegada de `player` desde cada celda; las celdas ocupadas no sirven de paso. */
function fillReachField(field: Int16Array, player: Player, passMines: boolean, maxDepth: number): void {
  field.fill(-1);
  let head = 0;
  let tail = 0;
  for (const i of ARRIVAL_CELLS[player]) {
    if (OCC_ANY[i] || (!passMines && MINE_ANY[i])) continue;
    field[i] = 0;
    QUEUE[tail++] = i;
  }
  while (head < tail) {
    const i = QUEUE[head++];
    const d = field[i];
    if (d >= maxDepth) continue;
    const r = Math.floor(i / BOARD_COLS) + 1;
    const c = (i % BOARD_COLS) + 1;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBoard(nr, nc)) continue;
      const j = cellIdx(nr, nc);
      if (field[j] !== -1 || !PASSABLE_GRID[j] || (!passMines && MINE_ANY[j])) continue;
      field[j] = d + 1;
      if (!OCC_ANY[j]) QUEUE[tail++] = j;
    }
  }
}

const OCC_IDX = new Int16Array(NCELLS);

function collectWinners(w: GameState, mover: Player, tokMax: number, needShip: boolean, needFly: boolean): number[] {
  if (needShip) fillReachField(FIELD_SHIP, mover, false, tokMax);
  if (needFly) fillReachField(FIELD_FLY, mover, true, tokMax);
  const out: number[] = [];
  for (let i = 0; i < w.pieces.length; i++) {
    const p = w.pieces[i];
    if (p.owner !== mover || !p.pos) continue;
    const fly = canPassMines(p.type);
    if (fly ? !needFly : !needShip) continue;
    const steps = (fly ? FIELD_FLY : FIELD_SHIP)[cellIdx(p.pos.r, p.pos.c)];
    if (steps >= 0 && steps * (p.damaged ? 2 : 1) <= tokMax) out.push(i);
  }
  return out;
}

/** Piezas rivales de `mover` que un disparo fatal inmovil de `mover` puede sacar del tablero (libera camino). */
function clearableVictims(w: GameState, mover: Player): number[] {
  const advanced = w.options.advancedActualRange;
  fillOccupancy(OCC_IDX, w.pieces);
  const victims: number[] = [];
  for (const e of w.pieces) {
    if (e.owner !== mover || !e.pos || e.type === 'AvionReconocimiento') continue;
    const range = Math.min(advanced ? getActualRange(e) : getNominalRange(e.type), BOARD_COLS);
    for (const [dr, dc] of DIRS) {
      for (let step = 1; step <= range; step++) {
        const nr = e.pos.r + dr * step;
        const nc = e.pos.c + dc * step;
        if (!inBoard(nr, nc)) break;
        const i = cellIdx(nr, nc);
        if (ISLAND_GRID[i]) break;
        const j = OCC_IDX[i];
        if (j === -1) continue;
        const t = w.pieces[j];
        if (t.owner !== mover && isFatalResult(resolveCombat(e, t, step, advanced)) && !victims.includes(j)) victims.push(j);
        break;
      }
    }
  }
  return victims;
}

/**
 * Indices de las piezas de `mover` que llegan a su zona de llegada en el turno que empieza (turn === mover, sin
 * ficha). Cuenta bloqueos y minas, y tambien que `mover` derribe de un disparo inmovil la pieza que le tapa el paso.
 */
export function moverWinners(w: GameState, mover: Player): number[] {
  if (w.phase !== 'play') return [];
  const tokMax = w.numberTokens[mover].reduce((m, t) => Math.max(m, t), 0);
  let needShip = false;
  let needFly = false;
  for (const p of w.pieces) {
    if (p.owner === mover && p.pos && goalDistance(mover, p.pos.r, p.pos.c) * (p.damaged ? 2 : 1) <= tokMax) {
      if (canPassMines(p.type)) needFly = true;
      else needShip = true;
    }
  }
  if (!needShip && !needFly) return [];

  OCC_ANY.fill(0);
  MINE_ANY.fill(0);
  for (const p of w.pieces) if (p.pos) OCC_ANY[cellIdx(p.pos.r, p.pos.c)] = 1;
  for (const m of w.mines) if (inBoard(m.r, m.c)) MINE_ANY[cellIdx(m.r, m.c)] = 1;
  let out = collectWinners(w, mover, tokMax, needShip, needFly);
  if (out.length > 0) return out;

  for (const v of clearableVictims(w, mover)) {
    const at = cellIdx((w.pieces[v].pos as Cell).r, (w.pieces[v].pos as Cell).c);
    OCC_ANY[at] = 0;
    out = collectWinners(w, mover, tokMax, needShip, needFly);
    OCC_ANY[at] = 1;
    if (out.length > 0) return out;
  }
  return out;
}

export function moverWinsNow(w: GameState, mover: Player): boolean {
  return moverWinners(w, mover).length > 0;
}

// ─── Heuristica barata para ordenar candidatos ───────────────────────────────

const OCC = new Int16Array(BOARD_ROWS * BOARD_COLS);

function rayThreat(w: GameState, mover: Piece, r: number, c: number, advanced: boolean): number {
  let best = 0;
  for (const [dr, dc] of DIRS) {
    for (let step = 1; step <= BOARD_COLS; step++) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!inBoard(nr, nc)) break;
      const i = cellIdx(nr, nc);
      if (ISLAND_GRID[i]) break;
      const j = OCC[i];
      if (j === -1) continue;
      const q = w.pieces[j];
      if (q.owner !== mover.owner && q.type !== 'AvionReconocimiento') {
        const range = advanced ? getActualRange(q) : getNominalRange(q.type);
        if (step <= range) {
          const res = resolveCombat(q, mover, step, advanced);
          const sev = isFatalResult(res) ? 1 : res === 'AVERIADO' ? 0.5 : 0;
          if (sev > best) best = sev;
        }
      }
      break;
    }
  }
  return best * materialValue(mover.type, mover.damaged);
}

function rayPotential(w: GameState, p: Piece, r: number, c: number, advanced: boolean): number {
  if (p.type === 'AvionReconocimiento' || p.type === 'AvionCombate') return 0;
  const range = Math.min(advanced ? getActualRange(p) : getNominalRange(p.type), BOARD_COLS);
  let best = 0;
  for (const [dr, dc] of DIRS) {
    for (let step = 1; step <= range; step++) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!inBoard(nr, nc)) break;
      const i = cellIdx(nr, nc);
      if (ISLAND_GRID[i]) break;
      const j = OCC[i];
      if (j === -1) continue;
      const q = w.pieces[j];
      if (q.owner !== p.owner) {
        const res = resolveCombat(p, q, step, advanced);
        const sev = isFatalResult(res) ? 1 : res === 'AVERIADO' ? 0.5 : 0;
        const v = sev * materialValue(q.type, q.damaged);
        if (v > best) best = v;
      }
      break;
    }
  }
  return best;
}

/** Desde (r, c) la pieza `p` puede dañar o hundir a alguno de los `runners` (indices) por un rayo libre. */
function stopHit(
  w: GameState,
  p: Piece,
  r: number,
  c: number,
  runners: readonly number[],
  advanced: boolean,
): { j: number; res: CombatResult } | null {
  if (p.type === 'AvionReconocimiento' || p.type === 'AvionCombate') return null;
  const range = Math.min(advanced ? getActualRange(p) : getNominalRange(p.type), BOARD_COLS);
  let found: { j: number; res: CombatResult } | null = null;
  for (const [dr, dc] of DIRS) {
    for (let step = 1; step <= range; step++) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!inBoard(nr, nc)) break;
      const i = cellIdx(nr, nc);
      if (ISLAND_GRID[i]) break;
      const j = OCC[i];
      if (j === -1) continue;
      if (runners.includes(j)) {
        const res = resolveCombat(p, w.pieces[j], step, advanced);
        if (res !== 'ILESO' && res !== 'ILESA' && (found === null || (isFatalResult(res) && !isFatalResult(found.res)))) {
          found = { j, res };
        }
      }
      break;
    }
  }
  return found;
}

interface StopPlan {
  path: CpuAction[];
  cost: number;
  fatal: boolean;
}

const PARENT = new Int16Array(NCELLS);

/**
 * Secuencias "mover y disparar" con las que una pieza propia daña o hunde a un corredor rival dentro del
 * presupuesto. Los aviones de combate no sirven aqui: atacan antes de moverse y ya salen como ataques simples.
 */
function stopPlans(w: GameState, me: Player, runners: readonly number[], budget: number, limit: number): StopPlan[] {
  const advanced = w.options.advancedActualRange;
  fillOccupancy(OCC, w.pieces);
  MINE_ANY.fill(0);
  for (const m of w.mines) if (inBoard(m.r, m.c)) MINE_ANY[cellIdx(m.r, m.c)] = 1;

  const plans: StopPlan[] = [];
  for (let pi = 0; pi < w.pieces.length; pi++) {
    const p = w.pieces[pi];
    if (p.owner !== me || !p.pos || p.type === 'AvionReconocimiento' || p.type === 'AvionCombate') continue;
    const stepCost = p.damaged ? 2 : 1;
    const maxSteps = Math.floor(budget / stepCost);
    const passes = canPassMines(p.type);
    const start = cellIdx(p.pos.r, p.pos.c);
    OCC[start] = -1;
    REACH_COST.fill(-1);
    REACH_COST[start] = 0;
    PARENT[start] = -1;
    QUEUE[0] = start;
    let head = 0;
    let tail = 1;
    const byRunner = new Map<number, StopPlan>();
    while (head < tail) {
      const cur = QUEUE[head++];
      const r = Math.floor(cur / BOARD_COLS) + 1;
      const c = (cur % BOARD_COLS) + 1;
      const d = REACH_COST[cur];
      const hit = stopHit(w, p, r, c, runners, advanced);
      if (hit) {
        const fatal = isFatalResult(hit.res);
        const prev = byRunner.get(hit.j);
        if (!prev || (fatal && !prev.fatal) || (fatal === prev.fatal && d * stepCost < prev.cost)) {
          const steps: Cell[] = [];
          for (let i = cur; i !== start; i = PARENT[i]) steps.push({ r: Math.floor(i / BOARD_COLS) + 1, c: (i % BOARD_COLS) + 1 });
          steps.reverse();
          const path: CpuAction[] = steps.map(to => ({ kind: 'move', pieceId: p.id, to }));
          path.push({ kind: 'attack', attackerId: p.id, targetId: w.pieces[hit.j].id });
          byRunner.set(hit.j, { path, cost: d * stepCost, fatal });
        }
      }
      if (d >= maxSteps) continue;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        const j = cellIdx(nr, nc);
        if (REACH_COST[j] !== -1 || !PASSABLE_GRID[j] || OCC[j] !== -1 || (!passes && MINE_ANY[j])) continue;
        REACH_COST[j] = d + 1;
        PARENT[j] = cur;
        QUEUE[tail++] = j;
      }
    }
    OCC[start] = pi;
    for (const plan of byRunner.values()) plans.push(plan);
  }
  plans.sort((x, y) => Number(y.fatal) - Number(x.fatal) || x.cost - y.cost);
  return plans.slice(0, limit);
}

/** Desde (r, c) la pieza `p` puede dañar o hundir a algun corredor rival. */
function stopsRunner(w: GameState, p: Piece, r: number, c: number, runners: readonly number[], advanced: boolean): boolean {
  return stopHit(w, p, r, c, runners, advanced) !== null;
}

// ─── Mejor golpe del rival en su turno (mover y atacar) ──────────────────────

const REACH_COST = new Int8Array(NCELLS);

interface Strike {
  value: number;
  shooter: number;
  cell: Cell;
  target: number;
  result: CombatResult;
}

/**
 * El ataque de mayor valor que `shooter` puede ejecutar en un turno con la ficha mas alta: cada pieza
 * propia que no sea avion de reconocimiento se mueve hasta `tokMax` pasos y dispara por un rayo ortogonal.
 * Los aviones de combate solo disparan desde donde estan (atacan antes de moverse).
 */
function bestStrike(s: GameState, shooter: Player): Strike | null {
  const pieces = s.pieces;
  const advanced = s.options.advancedActualRange;
  const tokMax = s.numberTokens[shooter].reduce((m, t) => Math.max(m, t), 0);
  fillOccupancy(OCC, pieces);
  MINE_ANY.fill(0);
  for (const m of s.mines) if (inBoard(m.r, m.c)) MINE_ANY[cellIdx(m.r, m.c)] = 1;

  let best: Strike | null = null;
  const consider = (e: Piece, ei: number, r: number, c: number, range: number) => {
    for (const [dr, dc] of DIRS) {
      for (let step = 1; step <= range; step++) {
        const nr = r + dr * step;
        const nc = c + dc * step;
        if (!inBoard(nr, nc)) break;
        const i = cellIdx(nr, nc);
        if (ISLAND_GRID[i]) break;
        const j = OCC[i];
        if (j === -1) continue;
        const t = pieces[j];
        if (t.owner !== shooter) {
          const res = resolveCombat(e, t, step, advanced);
          const sev = isFatalResult(res) ? 1 : res === 'AVERIADO' ? 0.5 : 0;
          const v = sev * materialValue(t.type, t.damaged);
          if (v > 0 && (best === null || v > best.value)) best = { value: v, shooter: ei, cell: { r, c }, target: j, result: res };
        }
        break;
      }
    }
  };

  for (let ei = 0; ei < pieces.length; ei++) {
    const e = pieces[ei];
    if (e.owner !== shooter || !e.pos || e.type === 'AvionReconocimiento') continue;
    const range = Math.min(advanced ? getActualRange(e) : getNominalRange(e.type), BOARD_COLS);
    const start = cellIdx(e.pos.r, e.pos.c);
    if (e.type === 'AvionCombate') {
      consider(e, ei, e.pos.r, e.pos.c, range);
      continue;
    }
    const stepCost = e.damaged ? 2 : 1;
    const maxSteps = Math.floor(tokMax / stepCost);
    const passes = canPassMines(e.type);
    OCC[start] = -1;
    REACH_COST.fill(-1);
    REACH_COST[start] = 0;
    QUEUE[0] = start;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const cur = QUEUE[head++];
      const r = Math.floor(cur / BOARD_COLS) + 1;
      const c = (cur % BOARD_COLS) + 1;
      consider(e, ei, r, c, range);
      const d = REACH_COST[cur];
      if (d >= maxSteps) continue;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        const j = cellIdx(nr, nc);
        if (REACH_COST[j] !== -1 || !PASSABLE_GRID[j] || OCC[j] !== -1 || (!passes && MINE_ANY[j])) continue;
        REACH_COST[j] = d + 1;
        QUEUE[tail++] = j;
      }
    }
    OCC[start] = ei;
  }
  return best;
}

/** Estado tras ejecutar el golpe (el atacante se mueve a `cell`; el blanco muere, se avería o queda revelado). */
function applyStrike(s: GameState, shooter: Player, k: Strike): GameState {
  const defender: Player = shooter === 'A' ? 'B' : 'A';
  const pieces = s.pieces.map((p, i) => {
    if (i === k.shooter) return { ...p, pos: k.cell };
    if (i !== k.target) return p;
    const seen = p.revealedTo.includes(shooter) ? p.revealedTo : [...p.revealedTo, shooter];
    if (isFatalResult(k.result)) return { ...p, pos: null, revealedTo: seen };
    if (k.result === 'AVERIADO') return { ...p, damaged: true, revealedTo: [shooter, defender] };
    return { ...p, revealedTo: seen };
  });
  return { ...s, pieces };
}

// ─── Busqueda en haz sobre el turno completo ─────────────────────────────────

interface Node {
  worlds: GameState[];
  path: CpuAction[];
  /** Presupuesto de movimiento gastado por el plan desde la raiz. */
  cost: number;
  slotUsed: boolean;
  /** Hash de la accion de ataque/reconocimiento del plan (distingue planes con el mismo tablero propio). */
  hitKey: number;
  bonus: number;
  score: number;
  /** Empuje solo para ordenar el haz: la pieza puede frenar al corredor rival en la proxima accion. */
  guide: number;
  sig: number;
}

interface Cand {
  a: CpuAction;
  cheap: number;
  cost: number;
  bonus: number;
  guide: number;
  /** Valor en el primer mundo (preseleccion). */
  v0: number;
  w0: GameState | null;
}

export interface PlanInput {
  view: PlayerView;
  me: Player;
  legal: readonly CpuAction[];
  budget: PlanBudget;
}

export interface PlanResult {
  path: CpuAction[];
  cost: number;
  score: number;
  /** Ficha a elegir cuando aun no hay una elegida (la mas baja que alcanza para el plan). */
  token: number | null;
}

const END_TURN: CpuAction = { kind: 'endTurn' };
/** Un estado en que el rival gana en su turno vale ~ -0.9, ordenado por la evaluacion normal. */
const LOSS_BASE = -0.9;
const LOSS_SCALE = 0.1;

export function planTurn(input: PlanInput): PlanResult {
  const { view, me, legal, budget } = input;
  const opp: Player = me === 'A' ? 'B' : 'A';
  const advanced = view.options.advancedActualRange;
  const fixedToken = view.selectedNumberToken;
  const legalTokens = legal
    .filter((a): a is Extract<CpuAction, { kind: 'selectToken' }> => a.kind === 'selectToken')
    .map(a => a.token)
    .sort((x, y) => x - y);
  const cap = fixedToken ?? (legalTokens.length > 0 ? legalTokens[legalTokens.length - 1] : 0);
  const maxCost = cap - view.movementBudgetSpent;

  const tokenFor = (cost: number): number => {
    if (fixedToken !== null) return fixedToken;
    for (const t of legalTokens) if (t >= cost) return t;
    return cap;
  };
  const penalty = (tok: number) => (fixedToken === null ? PLAN_TUNING.tokenPenalty * tok : 0);

  const idxById = new Map<string, number>();
  view.pieces.forEach((p, i) => idxById.set(p.id, i));
  const myIdx: number[] = [];
  view.pieces.forEach((p, i) => {
    if (p.owner === me) myIdx.push(i);
  });
  const hidden = new Set(view.hiddenIds);
  const unknownMaterial =
    view.unknownPool.length === 0
      ? 0
      : view.unknownPool.reduce((s, t) => s + materialValue(t, false), 0) / view.unknownPool.length;
  const tokMax = view.numberTokens[me].reduce((m, t) => Math.max(m, t), 0);

  const relevance = new Map<string, number>();
  for (const p of view.pieces) {
    if (p.owner !== opp || !p.pos) continue;
    const d = Math.min(goalDistance(opp, p.pos.r, p.pos.c), 24);
    relevance.set(p.id, 0.5 + 0.5 * (1 - d / 24));
  }

  const rawWorlds = makeWorlds(view, budget.worlds, turnSeed(view));
  const worlds0 = fixedToken === null ? rawWorlds.map(w => ({ ...w, selectedNumberToken: cap })) : rawWorlds;
  const K = worlds0.length;

  const closed = (w: GameState, tok: number): GameState => {
    const base = w.selectedNumberToken === tok ? w : { ...w, selectedNumberToken: tok };
    const next = applyAndAdvance(base, END_TURN);
    return typeof next === 'string' ? w : next;
  };

  const terminal = (w: GameState, tok: number): number => {
    if (w.phase === 'finished') return evaluate(w, me);
    const next = closed(w, tok);
    const v = evaluate(next, me);
    return PLAN_TUNING.dangerCheck && next !== w && moverWinsNow(next, opp) ? LOSS_BASE + LOSS_SCALE * v : v;
  };

  const signature = (w0: GameState, hitKey: number): number => {
    let h = HASH_SEED;
    for (const i of myIdx) {
      const p = w0.pieces[i];
      h = mixHash(h, p.pos ? p.pos.r * 64 + p.pos.c : 0);
      h = mixHash(h, p.damaged ? 1 : 0);
    }
    return mixHash(mixHash(h, hitKey), w0.mines.length);
  };

  const apply = (w: GameState, a: CpuAction): GameState => {
    const next = applyAndAdvance(w, a);
    return typeof next === 'string' ? w : next;
  };

  const scoreNode = (worlds: GameState[], cost: number, bonus: number): number => {
    const tok = tokenFor(cost);
    let sum = 0;
    for (const w of worlds) sum += terminal(w, tok);
    return sum / worlds.length + bonus - penalty(tok);
  };

  const root: Node = {
    worlds: worlds0,
    path: [],
    cost: 0,
    slotUsed: view.attackOrReconUsedThisTurn,
    hitKey: 0,
    bonus: 0,
    score: 0,
    guide: 0,
    sig: signature(worlds0[0], 0),
  };
  root.score = scoreNode(root.worlds, 0, 0);

  let best = root;
  let frontier: Node[] = [root];
  const layers = Math.max(0, maxCost) + 1;
  const shortlist: Node[] = [root];

  if (PLAN_TUNING.dangerCheck && !root.slotUsed && maxCost > 0) {
    const runners = moverWinners(closed(worlds0[0], tokenFor(0)), opp);
    if (runners.length > 0) {
      for (const plan of stopPlans(worlds0[0], me, runners, maxCost, PLAN_TUNING.stopPlans)) {
        let worlds = worlds0;
        for (const a of plan.path) worlds = worlds.map(w => apply(w, a));
        const target = plan.path[plan.path.length - 1];
        const hitKey = hashString(actionKey(target));
        const hiddenTarget = target.kind === 'attack' && hidden.has(target.targetId);
        const bonus = hiddenTarget ? PLAN_TUNING.infoAttack : 0;
        const node: Node = {
          worlds,
          path: plan.path,
          cost: plan.cost,
          slotUsed: true,
          hitKey,
          bonus,
          score: scoreNode(worlds, plan.cost, bonus),
          guide: 0,
          sig: signature(worlds[0], hitKey),
        };
        shortlist.push(node);
        if (node.score > best.score) best = node;
      }
    }
  }

  for (let layer = 0; layer < layers && frontier.length > 0; layer++) {
    const children = new Map<number, Node>();

    for (const node of frontier) {
      const w0 = node.worlds[0];
      const acts = enumerateActions(w0, me, undefined, { verify: false });
      fillOccupancy(OCC, w0.pieces);

      let minEff = 99;
      let min2Eff = 99;
      let minIdx = -1;
      for (const i of myIdx) {
        const p = w0.pieces[i];
        if (!p.pos) continue;
        const eff = goalDistance(me, p.pos.r, p.pos.c) * (p.damaged ? 2 : 1);
        if (eff < minEff) {
          min2Eff = minEff;
          minEff = eff;
          minIdx = i;
        } else if (eff < min2Eff) min2Eff = eff;
      }

      const winners = PLAN_TUNING.dangerCheck ? moverWinners(closed(w0, tokenFor(node.cost)), opp) : [];
      const danger = winners.length > 0;

      const moves: Cand[] = [];
      const hits: Cand[] = [];
      for (const a of acts) {
        if (a.kind === 'move') {
          const i = idxById.get(a.pieceId) as number;
          const p = w0.pieces[i];
          const from = p.pos as Cell;
          const mult = p.damaged ? 2 : 1;
          const e0 = goalDistance(me, from.r, from.c) * mult;
          const e1 = goalDistance(me, a.to.r, a.to.c) * mult;
          const prog0 = 1 - Math.min(e0, EVAL_WEIGHTS.advanceDist) / EVAL_WEIGHTS.advanceDist;
          const prog1 = 1 - Math.min(e1, EVAL_WEIGHTS.advanceDist) / EVAL_WEIGHTS.advanceDist;
          let cheap = EVAL_WEIGHTS.advance * EVAL_WEIGHTS.mobility[p.type] * (prog1 * prog1 - prog0 * prog0);
          const others = i === minIdx ? min2Eff : minEff;
          const newMin = Math.min(others, e1);
          cheap += (EVAL_WEIGHTS.race / EVAL_WEIGHTS.stepsPerTurn) * (minEff - newMin);
          cheap += ((newMin <= tokMax ? 1 : 0) - (minEff <= tokMax ? 1 : 0)) * EVAL_WEIGHTS.reachNowWaiting;

          const vacated = OCC[cellIdx(from.r, from.c)];
          OCC[cellIdx(from.r, from.c)] = -1;
          cheap -= rayThreat(w0, p, a.to.r, a.to.c, advanced) - rayThreat(w0, p, from.r, from.c, advanced);
          if (!node.slotUsed) {
            cheap += 0.8 * (rayPotential(w0, p, a.to.r, a.to.c, advanced) - rayPotential(w0, p, from.r, from.c, advanced));
          }
          const guide = danger && !node.slotUsed && stopsRunner(w0, p, a.to.r, a.to.c, winners, advanced) ? PLAN_TUNING.guide : 0;
          OCC[cellIdx(from.r, from.c)] = vacated;
          if (guide > 0) cheap += 40;

          moves.push({ a, cheap, cost: mult, bonus: 0, guide, v0: 0, w0: null });
        } else if (a.kind === 'placeMine') {
          if (danger) moves.push({ a, cheap: 30, cost: 0, bonus: 0, guide: 0, v0: 0, w0: null });
        } else if (a.kind === 'attack' || a.kind === 'recon') {
          const t = w0.pieces[idxById.get(a.targetId) as number];
          const isHidden = hidden.has(a.targetId);
          const value = isHidden ? unknownMaterial : materialValue(t.type, t.damaged);
          const rel = relevance.get(t.id) ?? 0.5;
          const bonus = isHidden ? (a.kind === 'attack' ? PLAN_TUNING.infoAttack : PLAN_TUNING.infoRecon) * rel : 0;
          hits.push({ a, cheap: (a.kind === 'attack' ? 60 : 40) + value, cost: 0, bonus, guide: 0, v0: 0, w0: null });
        }
      }
      if (node.slotUsed) hits.length = 0;
      hits.sort((x, y) => y.cheap - x.cheap);
      if (hits.length > PLAN_TUNING.maxAttackCands) hits.length = PLAN_TUNING.maxAttackCands;
      moves.sort((x, y) => y.cheap - x.cheap);

      const pool: Cand[] = hits.slice();
      const quota = danger && layer === 0 ? moves.length : Math.max(0, budget.breadth * budget.prefilter - pool.length);
      for (let k = 0; k < moves.length && k < quota; k++) pool.push(moves[k]);

      let kept: Cand[];
      if (budget.prefilter > 1 || (danger && layer === 0)) {
        for (const cand of pool) {
          const w = apply(w0, cand.a);
          const tok = tokenFor(node.cost + cand.cost);
          cand.w0 = w;
          cand.v0 = terminal(w, tok) + cand.bonus + node.bonus - penalty(tok);
        }
        pool.sort((x, y) => y.v0 + y.guide - (x.v0 + x.guide));
        kept = pool.slice(0, budget.breadth);
      } else {
        // Sin preseleccion los ataques no deben ocupar todos los lugares: al menos la mitad son movimientos.
        const hitSlots = Math.min(hits.length, Math.ceil(budget.breadth / 2));
        kept = [...hits.slice(0, hitSlots), ...moves.slice(0, budget.breadth - hitSlots)];
      }

      for (const cand of kept) {
        const cost = node.cost + cand.cost;
        const bonus = node.bonus + cand.bonus;
        const worlds: GameState[] = new Array(K);
        worlds[0] = cand.w0 ?? apply(w0, cand.a);
        for (let k = 1; k < K; k++) worlds[k] = apply(node.worlds[k], cand.a);
        const isHit = cand.a.kind === 'attack' || cand.a.kind === 'recon';
        const hitKey = isHit ? hashString(actionKey(cand.a)) : node.hitKey;
        const score = scoreNode(worlds, cost, bonus);
        const child: Node = {
          worlds,
          path: [...node.path, cand.a],
          cost,
          slotUsed: node.slotUsed || isHit,
          hitKey,
          bonus,
          score,
          guide: cand.guide,
          sig: signature(worlds[0], hitKey),
        };
        const prev = children.get(child.sig);
        if (!prev || prev.score < child.score) children.set(child.sig, child);
      }
    }

    const ranked = [...children.values()].sort((x, y) => y.score + y.guide - (x.score + x.guide));
    for (const n of ranked) if (n.score > best.score) best = n;
    frontier = ranked.slice(0, budget.beam);
    for (let k = 0; k < budget.finalists && k < ranked.length; k++) shortlist.push(ranked[k]);
  }

  if (budget.finalists > 0 && PLAN_TUNING.replyWeight > 0) {
    shortlist.sort((x, y) => y.score - x.score);
    const seen = new Set<number>();
    let top = -Infinity;
    for (const f of shortlist) {
      if (seen.size >= budget.finalists) break;
      const key = f.sig * 31 + f.cost;
      if (seen.has(key)) continue;
      seen.add(key);
      const tok = tokenFor(f.cost);
      let sum = 0;
      for (const w of f.worlds) {
        const stat = terminal(w, tok);
        let v = stat;
        if (w.phase !== 'finished') {
          const next = closed(w, tok);
          if (next !== w && next.phase === 'play' && !moverWinsNow(next, opp)) {
            const strike = bestStrike(next, opp);
            if (strike) v = stat + PLAN_TUNING.replyWeight * (Math.min(stat, evaluate(applyStrike(next, opp, strike), me)) - stat);
          }
        }
        sum += v;
      }
      const score = sum / f.worlds.length + f.bonus - penalty(tok);
      if (score > top) {
        top = score;
        best = f;
      }
    }
  }

  return {
    path: best.path,
    cost: best.cost,
    score: best.score,
    token: fixedToken === null ? tokenFor(best.cost) : null,
  };
}
