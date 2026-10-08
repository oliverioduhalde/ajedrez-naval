import type { GameState, UnitType } from '../../engine/types';
import { inBoard } from '../actions';
import { mixHash, finishHash, HASH_SEED, type Rng } from '../rng';
import { determinize, UNIT_TYPES, type PlayerView } from '../view';
import { RUNNER_BIAS } from './ismctsPolicy';

/**
 * Creencias sobre la identidad de las piezas enemigas ocultas y muestreo de mundos.
 *
 *  - uniform: cada determinizacion reparte el unknownPool al azar (lo que ofrece la fundacion).
 *  - hard:    ademas respeta restricciones duras que salen de la vista (una pieza oculta sobre una
 *             mina solo puede ser Minador o avion: los barcos y submarinos habrian explotado).
 *  - weighted: ademas pondera por comportamiento observado entre turnos (HiddenTracker). Esa parte es
 *             heuristica: supone que el rival elige a quien avanza como lo haria esta misma IA.
 */
export type BeliefMode = 'uniform' | 'hard' | 'weighted';

const MINE_PASSERS: readonly UnitType[] = ['Minador', 'AvionCombate', 'AvionReconocimiento'];
const NT = UNIT_TYPES.length;

function hiddenPositions(view: PlayerView): Map<string, { r: number; c: number } | null> {
  const out = new Map<string, { r: number; c: number } | null>();
  const hidden = new Set(view.hiddenIds);
  for (const p of view.pieces) if (hidden.has(p.id)) out.set(p.id, p.pos);
  return out;
}

/** Tipos permitidos por id oculto segun restricciones duras; undefined si no hay ninguna. */
export function hardAllowed(view: PlayerView): Record<string, UnitType[]> | undefined {
  if (view.hiddenIds.length === 0 || view.mines.length === 0) return undefined;
  const mined = new Set(view.mines.map(m => `${m.r},${m.c}`));
  const pool = new Set(view.unknownPool);
  const passers = MINE_PASSERS.filter(t => pool.has(t));
  if (passers.length === 0) return undefined;
  let out: Record<string, UnitType[]> | undefined;
  for (const [id, pos] of hiddenPositions(view)) {
    if (pos && mined.has(`${pos.r},${pos.c}`)) {
      out ??= {};
      out[id] = passers.slice();
    }
  }
  return out;
}

// ─── Seguimiento de piezas ocultas entre turnos ──────────────────────────────

export interface HiddenTrack {
  r: number;
  c: number;
  /** Pasos acumulados que se le atribuyen entre observaciones. */
  moves: number;
  /** Turnos del rival en que se la ha observado. */
  seen: number;
}

let tracks: HiddenTrack[] = [];
let trackSig = 0;

export function resetTracker(): void {
  tracks = [];
  trackSig = 0;
}

function enemyTurnSig(view: PlayerView): number {
  let h = HASH_SEED;
  for (const t of view.numberTokens.A) h = mixHash(h, t);
  h = mixHash(h, -1);
  for (const t of view.numberTokens.B) h = mixHash(h, t);
  let acc = 0;
  for (const p of view.pieces) {
    if (p.pos) acc = (acc + finishHash(mixHash(mixHash(h, p.pos.r * 32 + p.pos.c), p.owner === 'A' ? 1 : 2))) | 0;
  }
  return acc;
}

/**
 * Actualiza el seguimiento al comienzo de cada turno propio comparando las posiciones ocultas con
 * las de la observacion anterior: una pieza que no cambia de celda cuenta como quieta; las que
 * cambian se emparejan por cercania (el rival mueve a lo sumo 6 pasos por turno). Es la unica
 * memoria entre turnos que existe: la vista no trae historial.
 */
export function observeHidden(view: PlayerView): void {
  if (view.selectedNumberToken !== null || view.movementBudgetSpent > 0) return;
  const sig = enemyTurnSig(view);
  if (sig === trackSig) return;
  trackSig = sig;

  const now: { r: number; c: number }[] = [];
  const hidden = new Set(view.hiddenIds);
  for (const p of view.pieces) if (hidden.has(p.id) && p.pos) now.push({ r: p.pos.r, c: p.pos.c });

  const old = tracks;
  const next: HiddenTrack[] = [];
  const oldUsed = new Array<boolean>(old.length).fill(false);
  const nowUsed = new Array<boolean>(now.length).fill(false);

  for (let j = 0; j < now.length; j++) {
    const i = old.findIndex((t, k) => !oldUsed[k] && t.r === now[j].r && t.c === now[j].c);
    if (i !== -1) {
      oldUsed[i] = true;
      nowUsed[j] = true;
      next.push({ r: now[j].r, c: now[j].c, moves: old[i].moves, seen: old[i].seen + 1 });
    }
  }
  const pairs: { i: number; j: number; d: number }[] = [];
  for (let i = 0; i < old.length; i++) {
    if (oldUsed[i]) continue;
    for (let j = 0; j < now.length; j++) {
      if (nowUsed[j]) continue;
      const d = Math.abs(old[i].r - now[j].r) + Math.abs(old[i].c - now[j].c);
      if (d <= 6) pairs.push({ i, j, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  for (const { i, j, d } of pairs) {
    if (oldUsed[i] || nowUsed[j]) continue;
    oldUsed[i] = true;
    nowUsed[j] = true;
    next.push({ r: now[j].r, c: now[j].c, moves: old[i].moves + d, seen: old[i].seen + 1 });
  }
  for (let j = 0; j < now.length; j++) {
    if (!nowUsed[j]) next.push({ r: now[j].r, c: now[j].c, moves: 0, seen: 0 });
  }
  tracks = next;
}

const MEAN_BIAS = (() => {
  let s = 0;
  for (const t of UNIT_TYPES) s += RUNNER_BIAS[t];
  return s / UNIT_TYPES.length;
})();
const TRACK_GAMMA = 0.5;

/** Multiplicador de plausibilidad de `type` para una pieza con ese historial de movimiento. */
export function behaviorWeight(track: HiddenTrack | undefined, type: UnitType): number {
  if (!track || track.seen < 2) return 1;
  const activity = Math.min(1, track.moves / track.seen);
  const stillness = 1 - activity;
  return Math.exp(TRACK_GAMMA * (stillness - 0.7) * (RUNNER_BIAS[type] - MEAN_BIAS));
}

function trackAt(r: number, c: number): HiddenTrack | undefined {
  return tracks.find(t => t.r === r && t.c === c);
}

// ─── Muestreo de mundos ──────────────────────────────────────────────────────

export type WorldSampler = (rng: Rng) => GameState;

export function makeSampler(view: PlayerView, mode: BeliefMode): WorldSampler {
  const allowed = mode === 'uniform' ? undefined : hardAllowed(view);
  if (mode !== 'weighted' || view.hiddenIds.length === 0) {
    return rng => determinize(view, rng, allowed ? { allowed } : {});
  }

  const nH = view.hiddenIds.length;
  const positions = hiddenPositions(view);
  const W = new Float64Array(nH * NT).fill(1);
  const alive: number[] = [];
  for (let h = 0; h < nH; h++) {
    const id = view.hiddenIds[h];
    const pos = positions.get(id) ?? null;
    if (!pos || !inBoard(pos.r, pos.c)) continue;
    alive.push(h);
    const tr = trackAt(pos.r, pos.c);
    const allow = allowed?.[id];
    for (let t = 0; t < NT; t++) {
      let w = behaviorWeight(tr, UNIT_TYPES[t]);
      if (allow && !allow.includes(UNIT_TYPES[t])) w = 0;
      W[h * NT + t] = w;
    }
  }

  const base = new Int8Array(NT);
  for (const t of view.unknownPool) base[UNIT_TYPES.indexOf(t)]++;
  const tmp = new Float64Array(NT);

  return rng => {
    const rem = base.slice();
    const order = alive.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const x = order[i];
      order[i] = order[j];
      order[j] = x;
    }
    const single: Record<string, UnitType[]> = {};
    for (const h of order) {
      let total = 0;
      for (let t = 0; t < NT; t++) {
        const w = rem[t] > 0 ? rem[t] * W[h * NT + t] : 0;
        tmp[t] = w;
        total += w;
      }
      if (total <= 0) {
        for (let t = 0; t < NT; t++) {
          tmp[t] = rem[t] > 0 ? rem[t] : 0;
          total += tmp[t];
        }
      }
      let x = rng() * total;
      let pick = NT - 1;
      for (let t = 0; t < NT; t++) {
        x -= tmp[t];
        if (x < 0 && tmp[t] > 0) {
          pick = t;
          break;
        }
      }
      while (rem[pick] <= 0) pick = (pick + 1) % NT;
      rem[pick]--;
      single[view.hiddenIds[h]] = [UNIT_TYPES[pick]];
    }
    return determinize(view, rng, { allowed: single });
  };
}
