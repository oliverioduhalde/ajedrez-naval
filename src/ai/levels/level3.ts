import type { CpuAction } from '../types';
import type { LevelContext } from '../view';
import { actionKey } from '../actions';
import { budgetFor, findWinPlan, planTurn } from './turnplan';

type SelectToken = Extract<CpuAction, { kind: 'selectToken' }>;

const END_TURN: CpuAction = { kind: 'endTurn' };

/**
 * Reconocer o atacar ya, si el plan lo contiene y esta disponible: la informacion llega antes de seguir
 * moviendo. El reconocimiento revela lo mismo desde cualquier lugar; un ataque solo se adelanta si su autor
 * no se mueve antes (la distancia cambia el resultado de un barco contra un avion).
 */
function hoistHit(path: readonly CpuAction[], isLegal: (a: CpuAction) => boolean): CpuAction | null {
  const moved = new Set<string>();
  for (const a of path) {
    if (a.kind === 'move') moved.add(a.pieceId);
    else if (a.kind === 'recon' && isLegal(a)) return a;
    else if (a.kind === 'attack' && !moved.has(a.attackerId) && isLegal(a)) return a;
  }
  return null;
}

/**
 * OFICIAL: planifica el turno completo. Muestrea mundos compatibles con lo que se ve, busca en haz la
 * mejor secuencia de acciones del turno (ficha, pasos, ataque o reconocimiento) por el promedio de la
 * evaluacion al cerrar el turno, y juega la primera accion. No guarda estado: el plan se rehace en cada
 * llamada con mundos derivados de la vista, asi que el turno sigue siendo coherente.
 * `iterations` escala mundos, ancho del haz y candidatos (ver budgetFor); `timeBudgetMs` y `rng` no se usan:
 * el resultado depende solo de la vista y del presupuesto.
 */
export function level3Action(ctx: LevelContext): CpuAction {
  const { view, me, legal } = ctx;
  const keys = new Set(legal.map(actionKey));
  const isLegal = (a: CpuAction) => keys.has(actionKey(a));

  const fixed = view.selectedNumberToken;
  const tokens = legal
    .filter((a): a is SelectToken => a.kind === 'selectToken')
    .map(a => a.token)
    .sort((x, y) => x - y);
  const cap = fixed ?? (tokens.length > 0 ? tokens[tokens.length - 1] : 0);

  const win = findWinPlan(view, me, cap - view.movementBudgetSpent);
  if (win) {
    if (fixed === null) {
      const token = tokens.find(t => t >= win.cost);
      if (token !== undefined) return { kind: 'selectToken', token };
    } else {
      const step: CpuAction = { kind: 'move', pieceId: win.pieceId, to: win.path[0] };
      if (isLegal(step)) return step;
    }
  }

  const plan = planTurn({ view, me, legal, budget: budgetFor(ctx.iterations) });

  if (fixed === null) {
    const token = plan.token !== null && tokens.includes(plan.token) ? plan.token : tokens[0];
    return { kind: 'selectToken', token };
  }

  const hit = hoistHit(plan.path, isLegal);
  if (hit) return hit;
  const first = plan.path[0];
  if (first && isLegal(first)) return first;
  return END_TURN;
}
