import type { CpuAction } from '../types';
import type { LevelContext } from '../view';
import { goalDistance } from '../evaluate';
import { pick } from '../rng';

export function randomPolicy(ctx: LevelContext): CpuAction {
  return pick(ctx.legal, ctx.rng);
}

/** Ficha mas alta; ataca si puede; si no, avanza hacia la zona de llegada; si no, termina el turno. */
export function forwardPolicy(ctx: LevelContext): CpuAction {
  const { legal, view, me, rng } = ctx;

  const tokens = legal.filter(a => a.kind === 'selectToken');
  if (tokens.length > 0) return tokens[tokens.length - 1];

  const attacks = legal.filter(a => a.kind === 'attack');
  if (attacks.length > 0) return pick(attacks, rng);

  const forward = legal.filter(a => {
    if (a.kind !== 'move') return false;
    const from = view.pieces.find(p => p.id === a.pieceId)?.pos;
    return from !== undefined && from !== null && goalDistance(me, a.to.r, a.to.c) < goalDistance(me, from.r, from.c);
  });
  if (forward.length > 0) return pick(forward, rng);

  return { kind: 'endTurn' };
}
