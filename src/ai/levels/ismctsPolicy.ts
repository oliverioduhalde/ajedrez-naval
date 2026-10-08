import type { GameState, Piece, Player, UnitType } from '../../engine/types';
import type { Cell, CpuAction } from '../types';
import { isFatalResult, resolveCombat } from '../../engine/combat';
import { canPassMines, getActualRange, getNominalRange } from '../../engine/pieces';
import {
  applyAndAdvance,
  BOARD_COLS,
  BOARD_ROWS,
  cellIdx,
  fillOccupancy,
  inBoard,
  ISLAND_GRID,
  PASSABLE_GRID,
} from '../actions';
import { enumerateActions } from '../actions';
import { evaluate, goalDistance, materialValue } from '../evaluate';
import { pickWeighted, type Rng } from '../rng';

/**
 * Politica heuristica rapida que comparten los rollouts y los priores del arbol de ISMCTS.
 * Trabaja sobre mundos completos (GameState determinizado): es el unico sitio, junto con el
 * motor, donde se leen tipos enemigos, y siempre dentro de un mundo muestreado.
 */

export interface PolicyParams {
  /** Probabilidad de saltarse la heuristica en un paso (diversifica los rollouts). */
  epsilon: number;
  /** Valor minimo (material x severidad) para que un ataque se ejecute en el rollout. */
  attackThreshold: number;
  /** Ruido uniforme que se suma a la eleccion del corredor del turno. */
  runnerNoise: number;
  /** Exponente que sesga la eleccion de ficha hacia las altas. */
  tokenPower: number;
  /** Probabilidad de avanzar a una celda amenazada cuando es la unica que avanza. */
  riskTaking: number;
  /** Si se define, ese jugador usa los aviones de reconocimiento sobre piezas que no conoce. */
  reconPlayer: Player | null;
  reconProb: number;
  /** El bando que defiende intercepta al corredor enemigo cuando esta cerca de su zona. */
  defend: boolean;
  /** Antes de avanzar busca mover una pieza a una celda desde la que pueda atacar algo valioso. */
  hunt: boolean;
  /** Valor minimo de una caceria (con urgencia) para ejecutarla en el rollout. */
  huntThreshold: number;
  /** Con un ataque valioso disponible y sin carrera cercana, gasta la ficha mas chica. */
  thriftyToken: boolean;
  /** Los turnos del rival se juegan con la accion que maximiza evaluate (mas lento, rival mas fuerte). */
  greedyOpp: boolean;
  greedyAll: boolean;
  /** Candidatos de respuesta del rival que se prueban (se toma la peor para `me`); 1 = una sola respuesta heuristica. */
  oppSamples: number;
}

export const NCELLS = BOARD_ROWS * BOARD_COLS;
const UNREACHABLE = 99;
const DR = [-1, 1, 0, 0] as const;
const DC = [0, 0, -1, 1] as const;

const OCC = new Int16Array(NCELLS);
const MINEG = new Uint8Array(NCELLS);

/** Cuanto prefiere el corredor del turno a cada tipo (menor = mas dispuesto a avanzar). */
export const RUNNER_BIAS: Readonly<Record<UnitType, number>> = {
  AvionReconocimiento: -2.5,
  AvionCombate: -1,
  Fragata: 0,
  Submarino: 0.5,
  Minador: 1,
  Crucero: 1.5,
  Acorazado: 3,
};

const NOMINAL: Readonly<Record<UnitType, number>> = {
  Acorazado: getNominalRange('Acorazado'),
  Crucero: getNominalRange('Crucero'),
  Fragata: getNominalRange('Fragata'),
  Minador: getNominalRange('Minador'),
  Submarino: getNominalRange('Submarino'),
  AvionCombate: getNominalRange('AvionCombate'),
  AvionReconocimiento: getNominalRange('AvionReconocimiento'),
};

function attackRange(p: Piece, advanced: boolean): number {
  const r = advanced ? getActualRange(p) : NOMINAL[p.type];
  return r > BOARD_COLS ? BOARD_COLS : r;
}

function fillMines(mines: GameState['mines']): void {
  MINEG.fill(0);
  for (const m of mines) if (inBoard(m.r, m.c)) MINEG[cellIdx(m.r, m.c)] = 1;
}

/** Prepara las rejillas de ocupacion y minas para `state` (las usan todas las funciones de abajo). */
export function prepareGrids(state: GameState): void {
  fillOccupancy(OCC, state.pieces);
  fillMines(state.mines);
}

/**
 * Hay un enemigo de `victim` que la mataria desde su linea de tiro si estuviera en (r, c)?
 * `skip` es el indice de la propia victima (su celda de origen cuenta como vacia).
 */
export function fatalAt(
  pieces: readonly Piece[],
  r: number,
  c: number,
  victim: Piece,
  skip: number,
  advanced: boolean,
): boolean {
  for (let d = 0; d < 4; d++) {
    for (let step = 1; step <= BOARD_COLS; step++) {
      const nr = r + DR[d] * step;
      const nc = c + DC[d] * step;
      if (!inBoard(nr, nc)) break;
      const k = cellIdx(nr, nc);
      if (ISLAND_GRID[k]) break;
      const j = OCC[k];
      if (j === -1 || j === skip) continue;
      const a = pieces[j];
      if (a.owner !== victim.owner && a.type !== 'AvionReconocimiento' && step <= attackRange(a, advanced)) {
        if (isFatalResult(resolveCombat(a, victim, step, advanced))) return true;
      }
      break;
    }
  }
  return false;
}

// ─── Camino ganador ──────────────────────────────────────────────────────────

export interface WinPath {
  pieceIdx: number;
  cells: Cell[];
  cost: number;
}

const BFS_PREV = new Int16Array(NCELLS);
const BFS_COST = new Uint8Array(NCELLS);
const BFS_QUEUE = new Int16Array(NCELLS);

/**
 * Camino mas barato con el que una pieza de `me` entra a la zona de llegada rival gastando a lo
 * sumo `budget` puntos de movimiento (las demas piezas quietas; minas bloquean a quien no las pasa).
 * Requiere prepareGrids(state). Devuelve null si no hay.
 */
export function findWinPath(state: GameState, me: Player, budget: number): WinPath | null {
  if (budget <= 0) return null;
  let best: WinPath | null = null;
  const pieces = state.pieces;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.owner !== me || !p.pos) continue;
    const cost1 = p.damaged ? 2 : 1;
    const d0 = goalDistance(me, p.pos.r, p.pos.c);
    if (d0 >= UNREACHABLE || d0 * cost1 > budget) continue;
    if (best !== null && d0 * cost1 >= best.cost) continue;

    const passes = canPassMines(p.type);
    const start = cellIdx(p.pos.r, p.pos.c);
    BFS_COST.fill(255);
    BFS_COST[start] = 0;
    BFS_PREV[start] = -1;
    let head = 0;
    let tail = 0;
    BFS_QUEUE[tail++] = start;
    let found = -1;
    while (head < tail && found === -1) {
      const cur = BFS_QUEUE[head++];
      const cr = Math.floor(cur / BOARD_COLS) + 1;
      const cc = (cur % BOARD_COLS) + 1;
      const nextCost = BFS_COST[cur] + cost1;
      if (nextCost > budget) continue;
      for (let d = 0; d < 4; d++) {
        const nr = cr + DR[d];
        const nc = cc + DC[d];
        if (!inBoard(nr, nc)) continue;
        const k = cellIdx(nr, nc);
        if (!PASSABLE_GRID[k] || OCC[k] !== -1 || BFS_COST[k] !== 255) continue;
        if (MINEG[k] === 1 && !passes) continue;
        BFS_COST[k] = nextCost;
        BFS_PREV[k] = cur;
        if (goalDistance(me, nr, nc) === 0) {
          found = k;
          break;
        }
        BFS_QUEUE[tail++] = k;
      }
    }
    if (found !== -1 && (best === null || BFS_COST[found] < best.cost)) {
      const cells: Cell[] = [];
      for (let k = found; k !== start; k = BFS_PREV[k]) {
        cells.push({ r: Math.floor(k / BOARD_COLS) + 1, c: (k % BOARD_COLS) + 1 });
      }
      cells.reverse();
      best = { pieceIdx: i, cells, cost: BFS_COST[found] };
    }
  }
  return best;
}

// ─── Ataques ─────────────────────────────────────────────────────────────────

export interface AttackChoice {
  attackerIdx: number;
  targetIdx: number;
  value: number;
}

/** Valor (material x severidad) de que `attacker` dispare a `target` a `dist` celdas. */
export function attackValue(attacker: Piece, target: Piece, dist: number, advanced: boolean): number {
  const res = resolveCombat(attacker, target, dist, advanced);
  const severity = isFatalResult(res) ? 1 : res === 'AVERIADO' ? 0.5 : 0;
  if (severity === 0) return 0;
  return materialValue(target.type, target.damaged) * severity;
}

/**
 * Mejor ataque disponible para `me` en `state` (requiere prepareGrids). `allowCombatPlane` indica si
 * un AvionCombate todavia puede atacar este turno. Devuelve null si ninguno alcanza `minValue`.
 */
export function bestAttack(state: GameState, me: Player, minValue: number, allowCombatPlane: boolean): AttackChoice | null {
  const pieces = state.pieces;
  const advanced = state.options.advancedActualRange;
  let best: AttackChoice | null = null;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.owner !== me || !p.pos || p.type === 'AvionReconocimiento') continue;
    if (p.type === 'AvionCombate' && !allowCombatPlane) continue;
    const range = attackRange(p, advanced);
    for (let d = 0; d < 4; d++) {
      for (let step = 1; step <= range; step++) {
        const nr = p.pos.r + DR[d] * step;
        const nc = p.pos.c + DC[d] * step;
        if (!inBoard(nr, nc)) break;
        const k = cellIdx(nr, nc);
        if (ISLAND_GRID[k]) break;
        const j = OCC[k];
        if (j === -1) continue;
        const t = pieces[j];
        if (t.owner !== me) {
          const v = huntValue(p, t, step, advanced);
          if (v >= minValue && (best === null || v > best.value)) best = { attackerIdx: i, targetIdx: j, value: v };
        }
        break;
      }
    }
  }
  return best;
}

/** Un AvionReconocimiento de `me` con linea de vista a una pieza cuya identidad `me` ignora. */
function bestRecon(state: GameState, me: Player): { reconIdx: number; targetIdx: number } | null {
  const pieces = state.pieces;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.owner !== me || !p.pos || p.type !== 'AvionReconocimiento') continue;
    for (let d = 0; d < 4; d++) {
      for (let step = 1; step <= BOARD_COLS; step++) {
        const nr = p.pos.r + DR[d] * step;
        const nc = p.pos.c + DC[d] * step;
        if (!inBoard(nr, nc)) break;
        const k = cellIdx(nr, nc);
        if (ISLAND_GRID[k]) break;
        const j = OCC[k];
        if (j === -1) continue;
        const t = pieces[j];
        if (t.owner !== me && !t.damaged && !t.revealedTo.includes(me)) return { reconIdx: i, targetIdx: j };
        break;
      }
    }
  }
  return null;
}

// ─── Caceria: mover y atacar ─────────────────────────────────────────────────

export interface HuntPlan {
  pieceIdx: number;
  /** Celda destino (indice lineal) y costo en puntos de movimiento. */
  dest: number;
  cost: number;
  targetIdx: number;
  value: number;
}

const EN_R = new Int16Array(32);
const EN_C = new Int16Array(32);
export const HUNT_VAL = new Float64Array(32);
export const HUNT_FIRST = new Int16Array(32);
const URGENCY_REACH = 8;
const URGENCY_WEIGHT = 0.8;

/** Valor de que `attacker` dispare a `target`: material x severidad mas urgencia si es un corredor cercano a ganar. */
export function huntValue(attacker: Piece, target: Piece, dist: number, advanced: boolean): number {
  const res = resolveCombat(attacker, target, dist, advanced);
  const fatal = isFatalResult(res);
  const severity = fatal ? 1 : res === 'AVERIADO' ? 0.5 : 0;
  if (severity === 0) return 0;
  let v = materialValue(target.type, target.damaged) * severity;
  if (fatal && target.pos) {
    const eff = goalDistance(target.owner, target.pos.r, target.pos.c) * (target.damaged ? 2 : 1);
    if (eff < URGENCY_REACH) v += URGENCY_WEIGHT * (URGENCY_REACH - eff);
  }
  return v;
}

/**
 * Para cada pieza propia que puede atacar tras moverse (no AvionCombate ni reconocimiento), la mejor
 * combinacion celda alcanzable con `budget` puntos + ataque desde ella. Llena HUNT_VAL/HUNT_FIRST
 * (primer paso del camino, -1 si lo mejor es atacar sin mover) y devuelve el mejor plan global.
 * Requiere prepareGrids(state).
 */
export function computeHunts(state: GameState, me: Player, budget: number): HuntPlan | null {
  HUNT_VAL.fill(0);
  HUNT_FIRST.fill(-1);
  const pieces = state.pieces;
  const advanced = state.options.advancedActualRange;
  let best: HuntPlan | null = null;
  let ne = 0;
  for (const q of pieces) {
    if (q.owner !== me && q.pos) {
      EN_R[ne] = q.pos.r;
      EN_C[ne] = q.pos.c;
      ne++;
    }
  }
  if (ne === 0) return null;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.owner !== me || !p.pos || p.type === 'AvionReconocimiento' || p.type === 'AvionCombate') continue;
    const cost1 = p.damaged ? 2 : 1;
    const range = attackRange(p, advanced);
    const steps = Math.floor(budget / cost1);
    let near = false;
    for (let e = 0; e < ne && !near; e++) {
      const dr = Math.abs(p.pos.r - EN_R[e]);
      const dc = Math.abs(p.pos.c - EN_C[e]);
      near = (dr <= steps && dc - (steps - dr) <= range) || (dc <= steps && dr - (steps - dc) <= range);
    }
    if (!near) continue;
    const passes = canPassMines(p.type);
    const start = cellIdx(p.pos.r, p.pos.c);
    BFS_COST.fill(255);
    BFS_COST[start] = 0;
    BFS_PREV[start] = -1;
    let head = 0;
    let tail = 0;
    BFS_QUEUE[tail++] = start;
    let pBest = 0;
    let pCell = -1;
    let pTgt = -1;
    while (head < tail) {
      const cur = BFS_QUEUE[head++];
      const cr = Math.floor(cur / BOARD_COLS) + 1;
      const cc = (cur % BOARD_COLS) + 1;
      for (let d = 0; d < 4; d++) {
        for (let step = 1; step <= range; step++) {
          const nr = cr + DR[d] * step;
          const nc = cc + DC[d] * step;
          if (!inBoard(nr, nc)) break;
          const k = cellIdx(nr, nc);
          if (ISLAND_GRID[k]) break;
          const j = OCC[k];
          if (j === -1 || j === i) continue;
          const t = pieces[j];
          if (t.owner !== me) {
            const v = huntValue(p, t, step, advanced) - 0.05 * BFS_COST[cur];
            if (v > pBest && (cur === start || !fatalAt(pieces, cr, cc, p, i, advanced))) {
              pBest = v;
              pCell = cur;
              pTgt = j;
            }
          }
          break;
        }
      }
      const nextCost = BFS_COST[cur] + cost1;
      if (nextCost > budget) continue;
      for (let d = 0; d < 4; d++) {
        const nr = cr + DR[d];
        const nc = cc + DC[d];
        if (!inBoard(nr, nc)) continue;
        const k = cellIdx(nr, nc);
        if (!PASSABLE_GRID[k] || OCC[k] !== -1 || BFS_COST[k] !== 255) continue;
        if (MINEG[k] === 1 && !passes) continue;
        BFS_COST[k] = nextCost;
        BFS_PREV[k] = cur;
        BFS_QUEUE[tail++] = k;
      }
    }
    if (pCell === -1) continue;
    HUNT_VAL[i] = pBest;
    if (pCell !== start) {
      let first = pCell;
      while (BFS_PREV[first] !== start) first = BFS_PREV[first];
      HUNT_FIRST[i] = first;
    }
    if (best === null || pBest > best.value) best = { pieceIdx: i, dest: pCell, cost: BFS_COST[pCell], targetIdx: pTgt, value: pBest };
  }
  return best;
}

/** Ejecuta la caceria: camina hasta la celda y dispara. Devuelve el estado resultante (o el mismo si falla). */
function runHunt(s0: GameState, plan: HuntPlan): GameState {
  const p0 = s0.pieces[plan.pieceIdx];
  const target = s0.pieces[plan.targetIdx];
  const path: Cell[] = [];
  if (plan.cost > 0) {
    // el camino se recalcula: BFS_PREV ya fue pisado por las piezas siguientes de computeHunts
    const start = cellIdx((p0.pos as Cell).r, (p0.pos as Cell).c);
    const cost1 = p0.damaged ? 2 : 1;
    const passes = canPassMines(p0.type);
    BFS_COST.fill(255);
    BFS_COST[start] = 0;
    BFS_PREV[start] = -1;
    let head = 0;
    let tail = 0;
    BFS_QUEUE[tail++] = start;
    while (head < tail && BFS_COST[plan.dest] === 255) {
      const cur = BFS_QUEUE[head++];
      const cr = Math.floor(cur / BOARD_COLS) + 1;
      const cc = (cur % BOARD_COLS) + 1;
      const nextCost = BFS_COST[cur] + cost1;
      if (nextCost > plan.cost) continue;
      for (let d = 0; d < 4; d++) {
        const nr = cr + DR[d];
        const nc = cc + DC[d];
        if (!inBoard(nr, nc)) continue;
        const k = cellIdx(nr, nc);
        if (!PASSABLE_GRID[k] || OCC[k] !== -1 || BFS_COST[k] !== 255) continue;
        if (MINEG[k] === 1 && !passes) continue;
        BFS_COST[k] = nextCost;
        BFS_PREV[k] = cur;
        BFS_QUEUE[tail++] = k;
      }
    }
    if (BFS_COST[plan.dest] === 255) return s0;
    for (let k = plan.dest; k !== start; k = BFS_PREV[k]) {
      path.push({ r: Math.floor(k / BOARD_COLS) + 1, c: (k % BOARD_COLS) + 1 });
    }
    path.reverse();
  }
  let s = s0;
  for (const to of path) {
    const n = tryApply(s, { kind: 'move', pieceId: p0.id, to });
    if (n === s) return s;
    s = n;
    if (s.phase === 'finished') return s;
  }
  fillOccupancy(OCC, s.pieces);
  const atk = tryApply(s, { kind: 'attack', attackerId: p0.id, targetId: target.id });
  if (atk !== s) fillOccupancy(OCC, atk.pieces);
  return atk;
}

// ─── Rollout de un turno ─────────────────────────────────────────────────────

function tryApply(s: GameState, a: CpuAction): GameState {
  const n = applyAndAdvance(s, a);
  return typeof n === 'string' ? s : n;
}

function pickToken(s: GameState, me: Player, rng: Rng, P: PolicyParams): number {
  const tokens = s.numberTokens[me];
  let max = 0;
  for (const t of tokens) if (t > max) max = t;
  const win = findWinPath(s, me, max);
  if (win) {
    let pick = max;
    for (const t of tokens) if (t >= win.cost && t < pick) pick = t;
    return pick;
  }
  if (P.hunt) {
    const plan = computeHunts(s, me, max);
    if (plan !== null && plan.value >= P.huntThreshold) {
      let pick = max;
      for (const t of tokens) if (t >= plan.cost && t < pick) pick = t;
      return pick;
    }
  }
  if (P.thriftyToken) {
    const atk = bestAttack(s, me, 3, true);
    if (atk) {
      let distGoal = UNREACHABLE;
      for (const p of s.pieces) {
        if (p.owner === me && p.pos) {
          const d = goalDistance(me, p.pos.r, p.pos.c) * (p.damaged ? 2 : 1);
          if (d < distGoal) distGoal = d;
        }
      }
      if (distGoal > 10) {
        let min = 99;
        for (const t of tokens) if (t < min) min = t;
        return min;
      }
    }
  }
  const weights = tokens.map(t => Math.pow(t, P.tokenPower));
  return tokens[pickWeighted(weights, rng)];
}

function applyAttackChoice(s: GameState, a: AttackChoice): GameState {
  const next = tryApply(s, {
    kind: 'attack',
    attackerId: s.pieces[a.attackerIdx].id,
    targetId: s.pieces[a.targetIdx].id,
  });
  if (next !== s) fillOccupancy(OCC, next.pieces);
  return next;
}

function tryRecon(s: GameState, me: Player): GameState {
  const rc = bestRecon(s, me);
  if (!rc) return s;
  return tryApply(s, { kind: 'recon', pieceId: s.pieces[rc.reconIdx].id, targetId: s.pieces[rc.targetIdx].id });
}

const CAND_IDX = new Int16Array(32);
const CAND_KEY = new Float64Array(32);

/**
 * Juega hasta el final el turno en curso con la heuristica (token, ataque, corredor, ataque, fin)
 * y devuelve el estado con el turno ya entregado al rival (o terminado). Si no puede avanzar
 * (accion rechazada) devuelve el mismo estado: el llamador debe cortar el bucle.
 */
export function rolloutTurn(state: GameState, rng: Rng, P: PolicyParams): GameState {
  if (state.phase !== 'play') return state;
  const me = state.turn;
  let s = state;
  prepareGrids(s);

  if (s.selectedNumberToken === null) {
    const tok = pickToken(s, me, rng, P);
    const n = tryApply(s, { kind: 'selectToken', token: tok });
    if (n === s) return s;
    s = n;
  }
  const token = s.selectedNumberToken as number;

  const win = findWinPath(s, me, token - s.movementBudgetSpent);
  if (win) {
    const id = s.pieces[win.pieceIdx].id;
    for (const to of win.cells) {
      const n = tryApply(s, { kind: 'move', pieceId: id, to });
      if (n === s) break;
      s = n;
      if (s.phase === 'finished') return s;
    }
  }

  const useRecon = P.reconPlayer === me && rng() < P.reconProb;
  if (!s.attackOrReconUsedThisTurn && rng() >= P.epsilon) {
    const atk = bestAttack(s, me, P.attackThreshold, s.movementBudgetSpent === 0 && !s.combatPlaneAttackUsedThisTurn);
    const plan = P.hunt ? computeHunts(s, me, token - s.movementBudgetSpent) : null;
    if (plan !== null && plan.value >= P.huntThreshold && (atk === null || plan.value > atk.value + 0.5)) s = runHunt(s, plan);
    else if (atk) s = applyAttackChoice(s, atk);
  }
  if (P.defend) s = defendStep(s, me, rng, P);
  s = advanceRunners(s, me, rng, P);
  if (s.phase === 'finished') return s;

  if (!s.attackOrReconUsedThisTurn) {
    prepareGridsKeep(s);
    const atk = bestAttack(s, me, P.attackThreshold, false);
    if (atk) s = applyAttackChoice(s, atk);
    else if (useRecon) s = tryRecon(s, me);
  }

  const done = applyAndAdvance(s, { kind: 'endTurn' });
  return typeof done === 'string' ? s : done;
}

function prepareGridsKeep(s: GameState): void {
  fillOccupancy(OCC, s.pieces);
}

function advanceRunners(s0: GameState, me: Player, rng: Rng, P: PolicyParams): GameState {
  let s = s0;
  const token = s.selectedNumberToken as number;
  if (token - s.movementBudgetSpent <= 0) return s;
  const advanced = s.options.advancedActualRange;
  fillOccupancy(OCC, s.pieces);

  let n = 0;
  const pieces0 = s.pieces;
  for (let i = 0; i < pieces0.length && n < 32; i++) {
    const p = pieces0[i];
    if (p.owner !== me || !p.pos) continue;
    const d = goalDistance(me, p.pos.r, p.pos.c);
    if (d >= UNREACHABLE) continue;
    CAND_IDX[n] = i;
    CAND_KEY[n] = d * (p.damaged ? 2 : 1) + RUNNER_BIAS[p.type] + rng() * P.runnerNoise;
    n++;
  }
  for (let a = 1; a < n; a++) {
    const ki = CAND_IDX[a];
    const kk = CAND_KEY[a];
    let b = a - 1;
    while (b >= 0 && CAND_KEY[b] > kk) {
      CAND_IDX[b + 1] = CAND_IDX[b];
      CAND_KEY[b + 1] = CAND_KEY[b];
      b--;
    }
    CAND_IDX[b + 1] = ki;
    CAND_KEY[b + 1] = kk;
  }

  for (let ci = 0; ci < n; ci++) {
    const idx = CAND_IDX[ci];
    for (;;) {
      const p = s.pieces[idx];
      const left = token - s.movementBudgetSpent;
      const cost = p.damaged ? 2 : 1;
      if (left < cost || !p.pos) break;
      const to = pickStep(s, me, idx, p, advanced, rng, P);
      if (to === null) break;
      const from = cellIdx(p.pos.r, p.pos.c);
      const next = tryApply(s, { kind: 'move', pieceId: p.id, to });
      if (next === s) break;
      s = next;
      OCC[from] = -1;
      OCC[cellIdx(to.r, to.c)] = idx;
      if (s.phase === 'finished') return s;
    }
    if (token - s.movementBudgetSpent <= 0) break;
  }
  return s;
}

/** Siguiente celda del corredor `idx`: avanza hacia la zona de llegada, evitando amenazas fatales. */
function pickStep(s: GameState, me: Player, idx: number, p: Piece, advanced: boolean, rng: Rng, P: PolicyParams): Cell | null {
  const pos = p.pos as Cell;
  const curD = goalDistance(me, pos.r, pos.c);
  const passes = canPassMines(p.type);
  let safeCell: Cell | null = null;
  let riskyCell: Cell | null = null;
  let nSafe = 0;
  for (let d = 0; d < 4; d++) {
    const nr = pos.r + DR[d];
    const nc = pos.c + DC[d];
    if (!inBoard(nr, nc)) continue;
    const k = cellIdx(nr, nc);
    if (!PASSABLE_GRID[k] || OCC[k] !== -1) continue;
    if (MINEG[k] === 1 && !passes) continue;
    if (goalDistance(me, nr, nc) >= curD) continue;
    if (fatalAt(s.pieces, nr, nc, p, idx, advanced)) {
      riskyCell = { r: nr, c: nc };
    } else {
      nSafe++;
      if (safeCell === null || rng() < 1 / nSafe) safeCell = { r: nr, c: nc };
    }
  }
  if (safeCell !== null) return rng() < P.epsilon && riskyCell !== null ? riskyCell : safeCell;
  if (riskyCell !== null && rng() < P.riskTaking) return riskyCell;
  return null;
}

/**
 * Defensa simple: si un enemigo esta a pocos pasos de la zona que `me` protege y alguna pieza propia
 * puede acercarse a su linea de tiro, esa pieza avanza hacia el. Gasta como mucho la mitad del presupuesto.
 */
function defendStep(s0: GameState, me: Player, rng: Rng, P: PolicyParams): GameState {
  const enemy: Player = me === 'A' ? 'B' : 'A';
  let threat: Piece | null = null;
  let threatD = 8;
  for (const q of s0.pieces) {
    if (q.owner !== enemy || !q.pos) continue;
    const d = goalDistance(enemy, q.pos.r, q.pos.c);
    if (d < threatD) {
      threatD = d;
      threat = q;
    }
  }
  if (threat === null || !threat.pos) return s0;
  const tpos = threat.pos;
  const advanced = s0.options.advancedActualRange;
  const token = s0.selectedNumberToken as number;
  let s = s0;
  let spent = 0;
  const limit = Math.ceil((token - s.movementBudgetSpent) / 2);
  fillOccupancy(OCC, s.pieces);

  let bestIdx = -1;
  let bestD = 1e9;
  for (let i = 0; i < s.pieces.length; i++) {
    const p = s.pieces[i];
    if (p.owner !== me || !p.pos || p.type === 'AvionReconocimiento') continue;
    const man = Math.abs(p.pos.r - tpos.r) + Math.abs(p.pos.c - tpos.c);
    const reach = (p.type === 'AvionCombate' ? 99 : NOMINAL[p.type]) + limit;
    if (man > reach + 2) continue;
    const key = man + RUNNER_BIAS[p.type] * 0.3 + rng();
    if (key < bestD) {
      bestD = key;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return s0;

  while (spent < limit) {
    const p = s.pieces[bestIdx];
    if (!p.pos) break;
    const cost = p.damaged ? 2 : 1;
    if (token - s.movementBudgetSpent < cost) break;
    const cur = Math.abs(p.pos.r - tpos.r) + Math.abs(p.pos.c - tpos.c);
    const passes = canPassMines(p.type);
    let to: Cell | null = null;
    let bestKey = 1e9;
    for (let d = 0; d < 4; d++) {
      const nr = p.pos.r + DR[d];
      const nc = p.pos.c + DC[d];
      if (!inBoard(nr, nc)) continue;
      const k = cellIdx(nr, nc);
      if (!PASSABLE_GRID[k] || OCC[k] !== -1) continue;
      if (MINEG[k] === 1 && !passes) continue;
      const man = Math.abs(nr - tpos.r) + Math.abs(nc - tpos.c);
      if (man >= cur) continue;
      if (fatalAt(s.pieces, nr, nc, p, bestIdx, advanced)) continue;
      const key = man + rng() * 0.1;
      if (key < bestKey) {
        bestKey = key;
        to = { r: nr, c: nc };
      }
    }
    if (to === null) break;
    const from = cellIdx(p.pos.r, p.pos.c);
    const next = tryApply(s, { kind: 'move', pieceId: p.id, to });
    if (next === s) break;
    s = next;
    OCC[from] = -1;
    OCC[cellIdx(to.r, to.c)] = bestIdx;
    spent += cost;
    if (s.phase === 'finished') return s;
    const q = s.pieces[bestIdx];
    if (q.pos && !s.attackOrReconUsedThisTurn && q.type !== 'AvionReconocimiento') {
      fillOccupancy(OCC, s.pieces);
      const atk = bestAttack(s, me, P.attackThreshold, false);
      if (atk) {
        s = applyAttackChoice(s, atk);
        break;
      }
    }
  }
  return s;
}

// ─── Priores del arbol ───────────────────────────────────────────────────────

const ESCAPE: Uint8Array = new Uint8Array(32);

/**
 * Peso heuristico (> 0) de cada accion legal de `state` para el jugador que mueve; sirve para ordenar
 * la expansion del arbol y como sesgo progresivo. `lastMoved` es el indice de la ultima pieza movida
 * en el turno (-1 si no se sabe). Requiere prepareGrids(state).
 */
export interface HiddenInfo {
  /** Indices (en world.pieces) de piezas cuyo tipo ignora el jugador que busca. */
  hidden: ReadonlySet<number>;
  searcher: Player;
  /** Tipos posibles de las ocultas con su multiplicidad. */
  pool: ReadonlyArray<readonly [UnitType, number]>;
  total: number;
}

const PROBE: Piece = { id: '', owner: 'A', type: 'Fragata', pos: null, damaged: false, revealedTo: [] };

/** Valor esperado de que `attacker` dispare a una pieza oculta a `dist` celdas, promediando sobre los tipos posibles. */
function expectedAttackValue(attacker: Piece, target: Piece, dist: number, advanced: boolean, info: HiddenInfo): number {
  let ev = 0;
  PROBE.owner = target.owner;
  PROBE.pos = target.pos;
  for (const [type, count] of info.pool) {
    PROBE.type = type;
    ev += (count / info.total) * huntValue(attacker, PROBE, dist, advanced);
  }
  return ev;
}

export function scoreActions(
  state: GameState,
  legal: readonly CpuAction[],
  pieceIndex: ReadonlyMap<string, number>,
  lastMoved: number,
  out: Float64Array,
  info: HiddenInfo | null = null,
): void {
  const me = state.turn;
  const pieces = state.pieces;
  const advanced = state.options.advancedActualRange;
  const token = state.selectedNumberToken;
  const left = token === null ? 0 : token - state.movementBudgetSpent;
  ESCAPE.fill(0);
  if (token !== null && !state.attackOrReconUsedThisTurn && left > 0) computeHunts(state, me, left);
  else {
    HUNT_VAL.fill(0);
    HUNT_FIRST.fill(-1);
  }

  let anyMoveWeight = 0;
  let endIdx = -1;
  for (let i = 0; i < legal.length; i++) {
    const a = legal[i];
    let w = 1;
    switch (a.kind) {
      case 'selectToken':
        w = 1 + 0.2 * a.token;
        break;
      case 'move': {
        const idx = pieceIndex.get(a.pieceId) as number;
        const p = pieces[idx];
        const pos = p.pos as Cell;
        const fwd = goalDistance(me, a.to.r, a.to.c) < goalDistance(me, pos.r, pos.c);
        const bias = Math.exp(-0.35 * RUNNER_BIAS[p.type]);
        let esc = ESCAPE[idx];
        if (esc === 0) {
          esc = fatalAt(pieces, pos.r, pos.c, p, -1, advanced) ? 2 : 1;
          ESCAPE[idx] = esc;
        }
        const safe = !fatalAt(pieces, a.to.r, a.to.c, p, idx, advanced);
        w = (fwd ? 1 : 0.15) * bias * (safe ? 1 : 0.2);
        if (esc === 2 && safe) w *= 2.5;
        if (idx === lastMoved) w *= 2;
        if (HUNT_FIRST[idx] === cellIdx(a.to.r, a.to.c) && HUNT_VAL[idx] > 0.5) w += 1.5 + 0.9 * HUNT_VAL[idx];
        anyMoveWeight += w;
        break;
      }
      case 'attack': {
        const at = pieces[pieceIndex.get(a.attackerId) as number];
        const tIdx = pieceIndex.get(a.targetId) as number;
        const tg = pieces[tIdx];
        const dist = Math.abs((at.pos as Cell).r - (tg.pos as Cell).r) + Math.abs((at.pos as Cell).c - (tg.pos as Cell).c);
        const v =
          info !== null && at.owner === info.searcher && info.hidden.has(tIdx)
            ? expectedAttackValue(at, tg, dist, advanced, info)
            : huntValue(at, tg, dist, advanced);
        w = v >= 0.4 ? 3 + v : 0.1 + v;
        break;
      }
      case 'recon': {
        const tg = pieces[pieceIndex.get(a.targetId) as number];
        w = !tg.damaged && !tg.revealedTo.includes(me) ? 1.6 : 0.2;
        break;
      }
      case 'placeMine':
        w = 0.25;
        break;
      case 'liftMine':
        w = 0.2;
        break;
      case 'endTurn':
        endIdx = i;
        w = 1;
        break;
    }
    out[i] = w;
  }
  if (endIdx !== -1) out[endIdx] = left <= 0 || anyMoveWeight === 0 ? 8 : 0.15;
}

/** Turno completo del jugador en turno eligiendo cada accion atomica por evaluate (vision de mundo completo). */
export function greedyTurn(state: GameState): GameState {
  if (state.phase !== 'play') return state;
  const me = state.turn;
  let s = state;
  for (let guard = 0; guard < 40; guard++) {
    const acts = enumerateActions(s, me, undefined, { verify: false });
    if (acts.length === 0) return s;
    let best: GameState | null = null;
    let bv = -Infinity;
    let bestEnd = false;
    for (const a of acts) {
      const n = applyAndAdvance(s, a);
      if (typeof n === 'string') continue;
      let v = evaluate(n, me);
      if (a.kind === 'endTurn') v -= 0.005;
      if (v > bv) {
        bv = v;
        best = n;
        bestEnd = a.kind === 'endTurn';
      }
    }
    if (best === null) return s;
    s = best;
    if (bestEnd || s.phase === 'finished') return s;
  }
  return s;
}
