import { expect } from 'vitest';
import type { GameState, Player } from '../engine/types';
import type { CpuAction, CpuLevel } from '../ai/types';
import { canSeeIdentity, confirmHandoff, createInitialState, finishSetup } from '../engine/gameEngine';
import { applyCpuAction, applyPlacements, enumerateActions } from '../ai/actions';
import { chooseActionStrict, chooseSetupStrict } from '../ai';
import { goalDistance } from '../ai/evaluate';
import { mulberry32, pickWeighted, shuffled } from '../ai/rng';
import { maskState } from '../ai/view';

/**
 * Permuta la identidad (tipo e id, que lo codifica) de las piezas enemigas ocultas para `me`
 * entre las posiciones que ocupan, conservando la composicion de flota: el mismo tablero
 * observable con otra verdad oculta.
 */
export function scrambleHidden(state: GameState, me: Player, rng: () => number): GameState {
  const slots = state.pieces.filter(p => p.owner !== me && !canSeeIdentity(p, me));
  const identities = shuffled(
    slots.map(p => ({ id: p.id, type: p.type })),
    rng,
  );
  const bySlot = new Map(slots.map((p, i) => [p.id, identities[i]]));
  return {
    ...state,
    pieces: state.pieces.map(p => {
      const next = bySlot.get(p.id);
      return next ? { ...p, id: next.id, type: next.type } : p;
    }),
  };
}

export interface PlayGameOptions {
  maxTurns?: number;
  iterations?: number;
  timeBudgetMs?: number;
}

export interface PlayGameResult {
  winner: Player | null;
  turns: number;
  actions: number;
  state: GameState;
}

const MAX_ACTIONS_PER_TURN = 40;

/** Despliega ambos bandos con chooseSetupStrict y deja el estado en play (handoff confirmado). */
export function setupGame(levelA: CpuLevel, levelB: CpuLevel, seed: number, iterations?: number): GameState {
  let state = createInitialState();
  for (const [me, level, salt] of [
    ['A', levelA, 1],
    ['B', levelB, 2],
  ] as const) {
    const placements = chooseSetupStrict(state, me, level, { rng: mulberry32(seed * 7 + salt), iterations });
    const placed = applyPlacements(state, placements);
    if (typeof placed === 'string') throw new Error(`Despliegue de ${me} rechazado: ${placed}`);
    const done = finishSetup(placed);
    if (typeof done === 'string') throw new Error(`finishSetup de ${me} rechazado: ${done}`);
    state = done;
  }
  return confirmHandoff(state);
}

/** CPU contra CPU completo (despliegue, turnos, handoff) hasta victoria o maxTurns. Lanza ante una accion rechazada. */
export function playGame(levelA: CpuLevel, levelB: CpuLevel, seed: number, opts: PlayGameOptions = {}): PlayGameResult {
  const maxTurns = opts.maxTurns ?? 200;
  let state = setupGame(levelA, levelB, seed, opts.iterations);
  let turns = 0;
  let actions = 0;

  while (state.phase !== 'finished' && turns < maxTurns) {
    const me = state.turn;
    const level = me === 'A' ? levelA : levelB;
    let inTurn = 0;
    for (;;) {
      const action = chooseActionStrict(state, me, level, {
        rng: mulberry32(seed * 1000003 + actions),
        iterations: opts.iterations,
        timeBudgetMs: opts.timeBudgetMs,
      });
      const next = applyCpuAction(state, action);
      if (typeof next === 'string') throw new Error(`Accion rechazada (${next}): ${JSON.stringify(action)}`);
      state = next;
      actions++;
      if (++inTurn > MAX_ACTIONS_PER_TURN) throw new Error(`El turno de ${me} no termina`);
      if (state.phase === 'finished') {
        turns++;
        break;
      }
      if (action.kind === 'endTurn') {
        turns++;
        state = confirmHandoff(state);
        break;
      }
    }
  }
  return { winner: state.winner, turns, actions, state };
}

// ─── Estados de juego al azar con sesgo hacia el contacto ────────────────────

function biasedPick(state: GameState, legal: CpuAction[], rng: () => number): CpuAction {
  const me = state.turn;
  const weights = legal.map(a => {
    switch (a.kind) {
      case 'attack':
        return 8;
      case 'recon':
        return 3;
      case 'placeMine':
        return 1.5;
      case 'liftMine':
        return 1;
      case 'endTurn':
        return 0.6;
      case 'move': {
        const from = state.pieces.find(p => p.id === a.pieceId)!.pos!;
        return goalDistance(me, a.to.r, a.to.c) < goalDistance(me, from.r, from.c) ? 4 : 1;
      }
      default:
        return 1;
    }
  });
  return legal[pickWeighted(weights, rng)];
}

/** Aplica acciones sesgadas hasta completar el turno (endTurn + handoff) o hasta `stopAfter` acciones. */
function playBiasedTurn(state: GameState, rng: () => number, stopAfter = Infinity): GameState {
  let cur = state;
  for (let i = 0; i < MAX_ACTIONS_PER_TURN && i < stopAfter && cur.phase === 'play'; i++) {
    const legal = enumerateActions(cur, cur.turn);
    const action = biasedPick(cur, legal, rng);
    const next = applyCpuAction(cur, action);
    if (typeof next === 'string') throw new Error(`Accion rechazada (${next}): ${JSON.stringify(action)}`);
    cur = next;
    if (action.kind === 'endTurn') return confirmHandoff(cur);
  }
  return cur;
}

/**
 * Estado de juego tras `turns` turnos completos de juego sesgado hacia el contacto. Con midTurn
 * se corta ademas un turno a medias (ficha elegida, algunos movimientos, quiza un ataque).
 */
export function randomPlayState(seed: number, opts: { turns?: number; midTurn?: boolean } = {}): GameState {
  const rng = mulberry32(seed * 2654435761);
  let state = setupGame(1, 1, seed);
  for (let t = 0; t < (opts.turns ?? 0) && state.phase === 'play'; t++) state = playBiasedTurn(state, rng);
  if (opts.midTurn && state.phase === 'play') state = playBiasedTurn(state, rng, 1 + Math.floor(rng() * 6));
  return state;
}

export interface NonInterferenceReport {
  checked: number;
  withHidden: number;
}

/**
 * Si se permutan los tipos ocultos del rival (conservando la flota), chooseAction con la misma
 * semilla debe devolver la misma accion, y la vista enmascarada debe ser identica.
 */
export function assertNonInterference(
  level: CpuLevel,
  seeds: readonly number[],
  opts: { iterations?: number; scrambles?: number } = {},
): NonInterferenceReport {
  const scrambles = opts.scrambles ?? 3;
  let checked = 0;
  let withHidden = 0;

  for (const seed of seeds) {
    const state = randomPlayState(seed, { turns: 1 + (seed % 8), midTurn: seed % 2 === 0 });
    if (state.phase !== 'play') continue;
    const me = state.turn;
    const { view, ids } = maskState(state, me);
    const run = (s: GameState, withRng: boolean) => {
      const real = chooseActionStrict(s, me, level, {
        rng: withRng ? mulberry32(seed) : undefined,
        iterations: opts.iterations,
      });
      // Se compara en terminos de la vista: el id real de una pieza oculta cambia al permutar identidades.
      return maskState(s, me).ids.viewAction(real);
    };
    const baseSeeded = run(state, true);
    const baseDefault = run(state, false);

    for (let k = 0; k < scrambles; k++) {
      const scrambled = scrambleHidden(state, me, mulberry32(seed * 31 + k));
      expect(maskState(scrambled, me).view).toEqual(view);
      expect(run(scrambled, true)).toEqual(baseSeeded);
      expect(run(scrambled, false)).toEqual(baseDefault);
    }
    expect(ids.realAction(baseSeeded)).toEqual(chooseActionStrict(state, me, level, { rng: mulberry32(seed), iterations: opts.iterations }));
    checked++;
    if (view.hiddenIds.length > 0) withHidden++;
  }
  return { checked, withHidden };
}
