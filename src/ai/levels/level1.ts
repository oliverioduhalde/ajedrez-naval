import type { Piece } from '../../engine/types';
import type { CpuAction } from '../types';
import type { LevelContext, PlayerView, ViewPiece } from '../view';
import { isFatalResult, resolveCombat } from '../../engine/combat';
import { getActualRange, getNominalRange } from '../../engine/pieces';
import { BOARD_COLS, DIRS, ISLAND_GRID, cellIdx, inBoard } from '../actions';
import { goalDistance } from '../evaluate';
import { pick, pickWeighted } from '../rng';

/** Probabilidades por accion; nivel 1 es azar con un leve sesgo, no un plan. */
const P_BLUNDER = 0.18;
const P_ATTACK = 0.12;
const P_ATTACK_NO_MOVES = 0.4;
const P_RECON = 0.08;
const P_MINE = 0.04;
const P_END_TURN = 0.05;

const W_FORWARD = 3;
const W_SIDEWAYS = 1;
const W_BACKWARD = 0.5;
const W_DANGER = 0.25;
const PROGRESS_BIAS = 2;
const PROGRESS_SPAN = 24;

type MoveAction = Extract<CpuAction, { kind: 'move' }>;

function asPiece(p: ViewPiece): Piece | null {
  return p.type === null ? null : { id: p.id, owner: p.owner, type: p.type, pos: p.pos, damaged: p.damaged, revealedTo: p.revealedTo };
}

/**
 * Celdas del tablero que un enemigo YA identificado podria barrer con un disparo fatal contra `mover`
 * si este terminara en `to`. Las piezas ocultas no cuentan: el nivel 1 solo reacciona a lo que ve.
 */
function exposedToKnownFire(view: PlayerView, mover: Piece, from: ViewPiece, to: { r: number; c: number }): boolean {
  const occ = new Map<number, ViewPiece>();
  for (const p of view.pieces) if (p.pos && p !== from) occ.set(cellIdx(p.pos.r, p.pos.c), p);
  const advanced = view.options.advancedActualRange;

  for (const [dr, dc] of DIRS) {
    for (let step = 1; step <= BOARD_COLS; step++) {
      const r = to.r + dr * step;
      const c = to.c + dc * step;
      if (!inBoard(r, c)) break;
      const i = cellIdx(r, c);
      if (ISLAND_GRID[i]) break;
      const other = occ.get(i);
      if (!other) continue;
      const attacker = other.owner !== mover.owner ? asPiece(other) : null;
      if (attacker && attacker.type !== 'AvionReconocimiento') {
        const reach = advanced ? getActualRange(attacker) : getNominalRange(attacker.type);
        if (step <= reach && isFatalResult(resolveCombat(attacker, mover, step, advanced))) return true;
      }
      break;
    }
  }
  return false;
}

function progressOf(me: LevelContext['me'], p: ViewPiece): number {
  if (!p.pos) return 0;
  const d = Math.min(goalDistance(me, p.pos.r, p.pos.c), PROGRESS_SPAN);
  return 1 - d / PROGRESS_SPAN;
}

function pickMove(ctx: LevelContext, moves: MoveAction[]): MoveAction {
  const { view, me, rng } = ctx;
  const byId = new Map(view.pieces.map(p => [p.id, p]));
  const weights = moves.map(m => {
    const piece = byId.get(m.pieceId) as ViewPiece;
    const from = piece.pos as { r: number; c: number };
    const delta = goalDistance(me, m.to.r, m.to.c) - goalDistance(me, from.r, from.c);
    const dir = delta < 0 ? W_FORWARD : delta > 0 ? W_BACKWARD : W_SIDEWAYS;
    const p = progressOf(me, piece);
    let w = dir * (1 + PROGRESS_BIAS * p * p);
    const known = asPiece(piece);
    if (known && exposedToKnownFire(view, known, piece, m.to)) w *= W_DANGER;
    return w;
  });
  return moves[pickWeighted(weights, rng)];
}

/**
 * GRUMETE: casi al azar. Elige ficha y pieza sin criterio, con un sesgo leve a avanzar, ataca o
 * reconoce de vez en cuando y comete errores a proposito (una de cada seis jugadas es uniforme).
 */
export function level1Action(ctx: LevelContext): CpuAction {
  const { legal, rng } = ctx;

  if (legal.every(a => a.kind === 'selectToken')) return pick(legal, rng);
  if (rng() < P_BLUNDER) return pick(legal, rng);

  const moves = legal.filter((a): a is MoveAction => a.kind === 'move');
  const attacks = legal.filter(a => a.kind === 'attack');
  const recons = legal.filter(a => a.kind === 'recon');
  const mines = legal.filter(a => a.kind === 'placeMine' || a.kind === 'liftMine');

  if (attacks.length > 0 && rng() < (moves.length > 0 ? P_ATTACK : P_ATTACK_NO_MOVES)) return pick(attacks, rng);
  if (recons.length > 0 && rng() < P_RECON) return pick(recons, rng);
  if (mines.length > 0 && rng() < P_MINE) return pick(mines, rng);
  if (moves.length === 0 || rng() < P_END_TURN) return { kind: 'endTurn' };

  return pickMove(ctx, moves);
}
