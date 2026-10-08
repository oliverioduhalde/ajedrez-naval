import type { GameState, Player, UnitType } from '../engine/types';
import { getCellKind } from '../engine/board';
import { isFatalResult, resolveCombat } from '../engine/combat';
import { getActualRange, getNominalRange } from '../engine/pieces';
import {
  BOARD_COLS,
  BOARD_ROWS,
  DIRS,
  ISLAND_GRID,
  PASSABLE_GRID,
  cellIdx,
  fillOccupancy,
  inBoard,
} from './actions';

/** Pesos de la funcion de evaluacion; todos ajustables. Escala aproximada: 1 pieza chica ~ 4 puntos. */
export const EVAL_WEIGHTS = {
  material: {
    Acorazado: 8,
    Crucero: 6,
    Fragata: 4,
    Minador: 3.5,
    Submarino: 5,
    AvionCombate: 6,
    AvionReconocimiento: 3,
  } as Record<UnitType, number>,
  /** Fraccion del valor material que conserva una pieza averiada. */
  damagedFactor: 0.55,
  /** Castigo extra por pieza averiada (costo doble de movimiento, alcance a la mitad). */
  damagedPenalty: 1,
  /** Extra por avion de combate vivo: alcance infinito, mata submarinos y aviones. */
  combatPlane: 1.5,
  /** Extra por avion de reconocimiento vivo. */
  reconPlane: 0.5,
  /** Puntos por turno de ventaja en llegar a la zona rival (distancia minima / stepsPerTurn). */
  race: 4,
  raceCapTurns: 6,
  stepsPerTurn: 4,
  /** Avance de todas las piezas (cuadratico: pesan mas las que ya estan cerca). */
  advance: 2.5,
  advanceDist: 24,
  /** Multiplicador del avance de una pieza bajo amenaza fatal inmediata. */
  threatenedAdvance: 0.5,
  /** Movilidad por tipo para el avance. */
  mobility: {
    Acorazado: 0.8,
    Crucero: 0.85,
    Fragata: 0.9,
    Minador: 1,
    Submarino: 0.9,
    AvionCombate: 1,
    AvionReconocimiento: 1,
  } as Record<UnitType, number>,
  /** Bono si la pieza mas cercana llega a la zona con la ficha disponible (mueve / espera). */
  reachNowMover: 12,
  reachNowWaiting: 5,
  /** Peso del mejor ataque inmediato (valor del blanco x severidad) y del resto de ataques. */
  threatBest: 0.6,
  threatRest: 0.15,
  /** Un ataque del bando que no mueve solo se concreta si el rival no lo evita. */
  threatWaitingFactor: 0.6,
  /** Minas propias en tablero. */
  mine: 0.25,
  mineCap: 8,
  /** Compresion a (-max, max): v = D / (|D| + scale) * max. */
  scale: 24,
  max: 0.98,
};

// ─── Distancia a la zona de llegada (BFS por celda, ignora piezas y minas) ──

const NCELLS = BOARD_ROWS * BOARD_COLS;
const UNREACHABLE = 99;

function buildGoalDist(target: 'arrivalA' | 'arrivalB'): Uint8Array {
  const dist = new Uint8Array(NCELLS).fill(UNREACHABLE);
  const queue: number[] = [];
  for (let r = 1; r <= BOARD_ROWS; r++) {
    for (let c = 1; c <= BOARD_COLS; c++) {
      if (getCellKind(r, c) === target) {
        dist[cellIdx(r, c)] = 0;
        queue.push(cellIdx(r, c));
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const r = Math.floor(i / BOARD_COLS) + 1;
    const c = (i % BOARD_COLS) + 1;
    for (const [dr, dc] of DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inBoard(nr, nc)) continue;
      const j = cellIdx(nr, nc);
      if (!PASSABLE_GRID[j] || dist[j] !== UNREACHABLE) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

const GOAL_DIST_A = buildGoalDist('arrivalB'); // las piezas de A ganan en la zona de B
const GOAL_DIST_B = buildGoalDist('arrivalA');

/** Pasos (ignorando piezas y minas) desde (r, c) hasta la zona de llegada que `player` necesita alcanzar. */
export function goalDistance(player: Player, r: number, c: number): number {
  return (player === 'A' ? GOAL_DIST_A : GOAL_DIST_B)[cellIdx(r, c)];
}

export function materialValue(type: UnitType, damaged: boolean): number {
  const v = EVAL_WEIGHTS.material[type];
  return damaged ? v * EVAL_WEIGHTS.damagedFactor : v;
}

// ─── Evaluacion ──────────────────────────────────────────────────────────────

const OCC = new Int16Array(NCELLS);
const THREAT = new Float32Array(64);

function side(p: Player): 0 | 1 {
  return p === 'A' ? 0 : 1;
}

/**
 * Valor de `state` para `me` en (-1, 1); victoria +1, derrota -1, partida terminada sin ganador 0.
 * Antisimetrica: evaluate(s, 'A') === -evaluate(s, 'B'). Pensada para estados completos (mundos
 * determinizados): lee el tipo de TODAS las piezas.
 */
export function evaluate(state: GameState, me: Player): number {
  if (state.phase === 'finished') {
    if (state.winner === null) return 0;
    return state.winner === me ? 1 : -1;
  }

  const W = EVAL_WEIGHTS;
  const pieces = state.pieces;
  const n = pieces.length;
  fillOccupancy(OCC, pieces);
  THREAT.fill(0, 0, n);

  const mover = side(state.turn);
  const advancedRange = state.options.advancedActualRange;
  const threatBest = [0, 0];
  const threatSum = [0, 0];

  // Amenazas inmediatas: primera pieza enemiga en cada rayo dentro del alcance.
  for (let i = 0; i < n; i++) {
    const p = pieces[i];
    if (!p.pos || p.type === 'AvionReconocimiento') continue;
    const range = advancedRange ? getActualRange(p) : getNominalRange(p.type);
    const maxSteps = Math.min(range, BOARD_COLS);
    const s = side(p.owner);
    for (const [dr, dc] of DIRS) {
      for (let step = 1; step <= maxSteps; step++) {
        const nr = p.pos.r + dr * step;
        const nc = p.pos.c + dc * step;
        if (!inBoard(nr, nc)) break;
        const k = cellIdx(nr, nc);
        if (ISLAND_GRID[k]) break;
        const j = OCC[k];
        if (j === -1) continue;
        const target = pieces[j];
        if (target.owner !== p.owner) {
          const res = resolveCombat(p, target, step, advancedRange);
          const severity = isFatalResult(res) ? 1 : res === 'AVERIADO' ? 0.5 : 0;
          if (severity > 0) {
            const v = materialValue(target.type, target.damaged) * severity;
            threatSum[s] += v;
            if (v > threatBest[s]) threatBest[s] = v;
            if (severity === 1) THREAT[j] = 1;
          }
        }
        break;
      }
    }
  }

  const material = [0, 0];
  const damagedCount = [0, 0];
  const combatPlanes = [0, 0];
  const reconPlanes = [0, 0];
  const advance = [0, 0];
  const minEff = [UNREACHABLE, UNREACHABLE];

  for (let i = 0; i < n; i++) {
    const p = pieces[i];
    if (!p.pos) continue;
    const s = side(p.owner);
    material[s] += materialValue(p.type, p.damaged);
    if (p.damaged) damagedCount[s]++;
    if (p.type === 'AvionCombate') combatPlanes[s]++;
    else if (p.type === 'AvionReconocimiento') reconPlanes[s]++;

    const eff = goalDistance(p.owner, p.pos.r, p.pos.c) * (p.damaged ? 2 : 1);
    if (eff < minEff[s]) minEff[s] = eff;
    const progress = 1 - Math.min(eff, W.advanceDist) / W.advanceDist;
    advance[s] += progress * progress * W.mobility[p.type] * (THREAT[i] > 0 ? W.threatenedAdvance : 1);
  }

  const mines = [0, 0];
  for (const m of state.mines) mines[side(m.owner)]++;

  const F = [0, 0];
  for (let s = 0; s < 2; s++) {
    const player: Player = s === 0 ? 'A' : 'B';
    const tokens = state.numberTokens[player];
    let maxTok = 0;
    for (const t of tokens) if (t > maxTok) maxTok = t;
    if (s === mover) {
      if (state.selectedNumberToken !== null) maxTok = state.selectedNumberToken - state.movementBudgetSpent;
    } else if (state.selectedNumberToken !== null && state.selectedNumberToken > maxTok) {
      maxTok = state.selectedNumberToken;
    }

    const turnsToGoal = Math.min(minEff[s] / W.stepsPerTurn, W.raceCapTurns);
    const reach = minEff[s] <= maxTok ? (s === mover ? W.reachNowMover : W.reachNowWaiting) : 0;
    const threatFactor = s === mover ? 1 : W.threatWaitingFactor;

    F[s] =
      material[s] +
      W.combatPlane * combatPlanes[s] +
      W.reconPlane * reconPlanes[s] -
      W.damagedPenalty * damagedCount[s] +
      W.advance * advance[s] -
      W.race * turnsToGoal +
      reach +
      threatFactor * (W.threatBest * threatBest[s] + W.threatRest * (threatSum[s] - threatBest[s])) +
      W.mine * Math.min(mines[s], W.mineCap);
  }

  const d = me === 'A' ? F[0] - F[1] : F[1] - F[0];
  return (d / (Math.abs(d) + W.scale)) * W.max;
}
