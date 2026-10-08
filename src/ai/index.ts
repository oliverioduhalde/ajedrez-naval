import type { GameState, Player } from '../engine/types';
import type { CpuAction, CpuLevel, CpuOptions, Placement } from './types';
import { getSetupCells } from '../engine/board';
import { confirmHandoff } from '../engine/gameEngine';
import { actionKey, applyPlacements, deriveTurnMemo, enumerateActions } from './actions';
import { level1Action } from './levels/level1';
import { level2Action } from './levels/level2';
import { level3Action } from './levels/level3';
import { level4Action, level5Action } from './levels/level45';
import { mulberry32, seedFrom, shuffled } from './rng';
import { planSetup } from './setup';
import { hashView, maskedView, maskHiddenTypes, maskState, type LevelContext, type SetupContext } from './view';

export {
  actionKey,
  applyAndAdvance,
  applyCpuAction,
  applyPlacements,
  deriveTurnMemo,
  EMPTY_MEMO,
  enumerateActions,
  MAX_MINE_ACTIONS_PER_TURN,
} from './actions';
export type { TurnMemo } from './actions';
export { evaluate, EVAL_WEIGHTS } from './evaluate';
export { determinize, hashView, maskedView, maskState, typeProbs } from './view';
export type { IdMap, LevelContext, MaskedState, PlayerView, SetupContext, ViewPiece } from './view';
export { CPU_LEVELS } from './types';
export type { CpuAction, CpuApi, CpuLevel, CpuOptions, Placement } from './types';

function runLevel(level: CpuLevel, ctx: LevelContext): CpuAction {
  switch (level) {
    case 2:
      return level2Action(ctx);
    case 3:
      return level3Action(ctx);
    case 4:
      return level4Action(ctx);
    case 5:
      return level5Action(ctx);
    default:
      return level1Action(ctx);
  }
}

function playable(state: GameState): GameState {
  return state.phase === 'handoffPlay' ? confirmHandoff(state) : state;
}

/**
 * UNA accion del subturno actual de `me`. El driver la llama en bucle hasta que devuelve endTurn.
 * Si el estado esta en handoffPlay se trata como play (el driver confirma el handoff antes de aplicar).
 * Fuera del turno de `me` devuelve endTurn. Los niveles reciben solo la vista enmascarada (con ids
 * opacos para las piezas enemigas ocultas); la accion devuelta ya trae los ids reales.
 * Lanza si un nivel falla o devuelve una accion fuera de `legal`; chooseAction lo captura.
 */
export function chooseActionStrict(state: GameState, me: Player, level: CpuLevel, opts: CpuOptions = {}): CpuAction {
  const working = playable(state);
  if (working.phase !== 'play' || working.turn !== me) return { kind: 'endTurn' };

  const realLegal = enumerateActions(maskHiddenTypes(working, me), me, deriveTurnMemo(working));
  if (realLegal.length === 0) return { kind: 'endTurn' };
  if (realLegal.length === 1) return realLegal[0];

  const { view, ids } = maskState(working, me);
  const legal = realLegal.map(ids.viewAction);
  const ctx: LevelContext = {
    view,
    me,
    legal,
    rng: opts.rng ?? mulberry32(seedFrom(hashView(view), level)),
    iterations: opts.iterations,
    timeBudgetMs: opts.timeBudgetMs,
  };
  const chosen = actionKey(runLevel(level, ctx));
  const i = legal.findIndex(a => actionKey(a) === chosen);
  if (i < 0) throw new Error(`El nivel ${level} devolvio una accion fuera de ctx.legal: ${chosen}`);
  return realLegal[i];
}

/** Como chooseActionStrict pero nunca lanza: ante un fallo del nivel elige la ficha mas alta o endTurn. */
export function chooseAction(state: GameState, me: Player, level: CpuLevel, opts: CpuOptions = {}): CpuAction {
  try {
    return chooseActionStrict(state, me, level, opts);
  } catch {
    try {
      const working = playable(state);
      const legal = enumerateActions(maskHiddenTypes(working, me), me, deriveTurnMemo(working));
      const tokens = legal.filter(a => a.kind === 'selectToken');
      if (tokens.length > 0) return tokens[tokens.length - 1];
    } catch {
      // sin acciones enumerables: endTurn es lo unico que queda
    }
    return { kind: 'endTurn' };
  }
}

function validateSetup(state: GameState, me: Player, placements: readonly Placement[]): void {
  const mine = state.pieces.filter(p => p.owner === me);
  const ids = new Set(placements.map(p => p.pieceId));
  if (placements.length !== mine.length || ids.size !== mine.length || mine.some(p => !ids.has(p.id))) {
    throw new Error('El despliegue debe tener exactamente una posicion por pieza propia');
  }
  const clean: GameState = {
    ...state,
    phase: state.phase === 'setupB' ? 'setupB' : 'setup',
    setupPlayer: me,
    pieces: state.pieces.map(p => (p.owner === me ? { ...p, pos: null } : p)),
  };
  const res = applyPlacements(clean, placements);
  if (typeof res === 'string') throw new Error(`Despliegue ilegal: ${res}`);
}

/** Despliegue de las 16 piezas de `me`. Lanza si el planificador devuelve algo que el motor rechaza. */
export function chooseSetupStrict(state: GameState, me: Player, level: CpuLevel, opts: CpuOptions = {}): Placement[] {
  const view = maskedView(state, me);
  const ctx: SetupContext = {
    view,
    me,
    level,
    rng: opts.rng ?? mulberry32(seedFrom(hashView(view), level, 'setup')),
    iterations: opts.iterations,
    timeBudgetMs: opts.timeBudgetMs,
  };
  const placements = planSetup(ctx);
  validateSetup(state, me, placements);
  return placements;
}

/** Como chooseSetupStrict pero nunca lanza: ante un fallo reparte las piezas al azar en la franja. */
export function chooseSetup(state: GameState, me: Player, level: CpuLevel, opts: CpuOptions = {}): Placement[] {
  try {
    return chooseSetupStrict(state, me, level, opts);
  } catch {
    const rng = opts.rng ?? mulberry32(seedFrom(level, 'setup-fallback'));
    const cells = shuffled(getSetupCells(me), rng);
    return state.pieces.filter(p => p.owner === me).map((p, i) => ({ pieceId: p.id, pos: cells[i] }));
  }
}
