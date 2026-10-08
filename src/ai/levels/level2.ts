import type { GameState, UnitType } from '../../engine/types';
import type { CpuAction } from '../types';
import type { LevelContext } from '../view';
import { applyAndAdvance } from '../actions';
import { evaluate, goalDistance } from '../evaluate';
import { otherPlayer, determinize, typeProbs } from '../view';

const DEFAULT_WORLDS = 3;
const MAX_WORLDS = 8;

/** Desempates y bonos, en la misma escala que evaluate() (valores en (-1, 1)). */
const TIE_FORWARD = 0.0006;
const TIE_ADVANCE = 0.0003;
const TIE_NOISE = 1e-6;
const RECON_BONUS = 0.012;

/** Los minadores solo siembran un cinturon a esta distancia (en pasos del rival) de la zona propia. */
const MINE_BELT_MIN = 3;
const MINE_BELT_MAX = 6;

type MoveAction = Extract<CpuAction, { kind: 'move' }>;

function withType(world: GameState, id: string, type: UnitType): GameState {
  return { ...world, pieces: world.pieces.map(p => (p.id === id ? { ...p, type } : p)) };
}

/**
 * Ficha: la mayor disponible. Probado en autojuego contra otras reglas (menor ficha que alcance para
 * ganar, no regalar una ficha mas alta que la mejor del rival, azar): la mayor es la que mejor rinde,
 * y entre ellas no hay diferencia que justifique mas logica en este nivel.
 */
function chooseToken(ctx: LevelContext): CpuAction {
  const tokens = ctx.legal.filter(a => a.kind === 'selectToken');
  return tokens[tokens.length - 1];
}

/** Las minas solo valen en un cinturon delante de la zona propia; levantar solo minas rivales. */
function mineWanted(ctx: LevelContext, a: CpuAction): boolean {
  const { view, me } = ctx;
  if (a.kind === 'placeMine') {
    const d = goalDistance(otherPlayer(me), a.at.r, a.at.c);
    return d >= MINE_BELT_MIN && d <= MINE_BELT_MAX;
  }
  if (a.kind === 'liftMine') return view.mines.some(m => m.r === a.at.r && m.c === a.at.c && m.owner !== me);
  return true;
}

function reconBonus(ctx: LevelContext, a: Extract<CpuAction, { kind: 'recon' }>): number {
  const { view, me } = ctx;
  const target = view.pieces.find(p => p.id === a.targetId);
  if (!target || !target.pos || target.type !== null) return 0;
  const threat = 1 - Math.min(goalDistance(otherPlayer(me), target.pos.r, target.pos.c), 24) / 24;
  const pool = view.unknownPool;
  let heavy = 0;
  for (const t of pool) if (t === 'Acorazado' || t === 'Crucero') heavy++;
  const pHeavy = pool.length > 0 ? heavy / pool.length : 0;
  return RECON_BONUS * (0.5 + threat) * (1 + 2 * pHeavy);
}

function moveTieBreak(ctx: LevelContext, a: MoveAction): number {
  const { view, me } = ctx;
  const piece = view.pieces.find(p => p.id === a.pieceId);
  if (!piece || !piece.pos) return 0;
  const from = goalDistance(me, piece.pos.r, piece.pos.c);
  const to = goalDistance(me, a.to.r, a.to.c);
  const closeness = 1 - Math.min(from, 24) / 24;
  return TIE_FORWARD * Math.sign(from - to) + TIE_ADVANCE * closeness;
}

/**
 * MARINERO: codicioso de una jugada. Puntua cada accion legal con evaluate() del estado resultante,
 * como ganancia respecto del estado actual y promediada en unos pocos mundos muestreados de lo que
 * el rival podria ser; para un ataque a una pieza oculta promedia exacto sobre los tipos posibles
 * (las probabilidades salen del pool de tipos desconocidos, nunca de la identidad real). Los aviones
 * de reconocimiento reciben un bono por identificar piezas ocultas, mayor cuanto mas cerca de
 * nuestra zona estan y cuanto mas probable es que sean pesadas.
 */
export function level2Action(ctx: LevelContext): CpuAction {
  const { legal, view, me, rng } = ctx;

  if (legal.every(a => a.kind === 'selectToken')) return chooseToken(ctx);

  const candidates = legal.filter(a => {
    if (a.kind === 'placeMine' || a.kind === 'liftMine') return mineWanted(ctx, a);
    if (a.kind === 'recon') {
      const target = view.pieces.find(p => p.id === a.targetId);
      return target !== undefined && target.type === null;
    }
    return true;
  });

  const nWorlds = view.hiddenIds.length === 0 ? 1 : Math.max(1, Math.min(MAX_WORLDS, ctx.iterations ?? DEFAULT_WORLDS));
  const worlds: GameState[] = [];
  for (let k = 0; k < nWorlds; k++) worlds.push(determinize(view, rng));
  const base = worlds.map(w => evaluate(w, me));
  const hidden = new Set(view.hiddenIds);

  const scoreMean = (a: CpuAction): number => {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < worlds.length; k++) {
      const next = applyAndAdvance(worlds[k], a);
      if (typeof next === 'string') continue;
      sum += evaluate(next, me) - base[k];
      n++;
    }
    return n > 0 ? sum / n : -Infinity;
  };

  const scoreAttackOnHidden = (a: Extract<CpuAction, { kind: 'attack' }>): number => {
    const w0 = worlds[0];
    let sum = 0;
    for (const [type, p] of typeProbs(view, a.targetId)) {
      const w = withType(w0, a.targetId, type);
      const next = applyAndAdvance(w, a);
      if (typeof next === 'string') continue;
      sum += p * (evaluate(next, me) - evaluate(w, me));
    }
    return sum;
  };

  let best: CpuAction = candidates[candidates.length - 1];
  let bestScore = -Infinity;
  for (const a of candidates) {
    let s: number;
    if (a.kind === 'attack' && hidden.has(a.targetId)) s = scoreAttackOnHidden(a);
    else s = scoreMean(a);
    if (a.kind === 'move') s += moveTieBreak(ctx, a);
    else if (a.kind === 'recon') s += reconBonus(ctx, a);
    s += rng() * TIE_NOISE;
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}
