import { afterEach, describe, expect, it } from 'vitest';
import type { GameState, Piece, Player, UnitType } from '../engine/types';
import type { CpuAction, CpuLevel } from '../ai/types';
import { confirmHandoff, createInitialState } from '../engine/gameEngine';
import { actionKey, applyCpuAction, deriveTurnMemo, enumerateActions } from '../ai/actions';
import { chooseAction, chooseActionStrict } from '../ai';
import { mulberry32, type Rng } from '../ai/rng';
import { FLEET_COUNTS, maskHiddenTypes, maskState, UNIT_TYPES, type LevelContext } from '../ai/view';
import { clearSearchMemory, L4_CONFIG, L5_CONFIG, searchLevel, setSearchMemory } from '../ai/levels/level45';
import { searchMemoryEnabled } from '../ai/levels/ismcts';
import { behaviorWeight, hardAllowed, makeSampler, observeHidden, resetTracker } from '../ai/levels/ismctsBelief';
import { assertNonInterference, randomPlayState, scrambleHidden, setupGame } from './ai.helpers';

const opp = (p: Player): Player => (p === 'A' ? 'B' : 'A');
const ITER = 60;

afterEach(() => {
  setSearchMemory(false);
  clearSearchMemory();
  resetTracker();
});

/** Estado de juego con solo las piezas indicadas en el tablero (el resto destruido). */
function scenario(
  placed: Record<string, { r: number; c: number }>,
  over: Partial<GameState> = {},
  pieceOver: Record<string, Partial<Piece>> = {},
): GameState {
  const base = createInitialState();
  return {
    ...base,
    phase: 'play',
    turn: 'A',
    selectedNumberToken: 4,
    numberTokens: { A: [2, 3, 4, 5, 6], B: [2, 3, 4, 5, 6] },
    pieces: base.pieces.map(p => ({ ...p, pos: placed[p.id] ?? null, ...pieceOver[p.id] })),
    ...over,
  };
}

function makeCtx(state: GameState, me: Player, seed: number, extra: { iterations?: number; timeBudgetMs?: number } = {}): LevelContext {
  const { view, ids } = maskState(state, me);
  const legal = enumerateActions(maskHiddenTypes(state, me), me, deriveTurnMemo(state)).map(ids.viewAction);
  return { view, me, legal, rng: mulberry32(seed), ...extra };
}

/** Juega el turno entero de `me` con chooseActionStrict y devuelve el estado final y las acciones. */
function playTurn(state: GameState, me: Player, level: CpuLevel, seed: number, iterations: number): { state: GameState; actions: CpuAction[] } {
  let s = state;
  const actions: CpuAction[] = [];
  for (let n = 0; n < 30; n++) {
    const a = chooseActionStrict(s, me, level, { rng: mulberry32(seed + n), iterations });
    const next = applyCpuAction(s, a);
    if (typeof next === 'string') throw new Error(`accion rechazada (${next}): ${JSON.stringify(a)}`);
    s = next;
    actions.push(a);
    if (a.kind === 'endTurn' || s.phase === 'finished') break;
  }
  return { state: s, actions };
}

/** Rival ingenuo: ficha mas alta, ataca si puede, avanza, si no termina. */
function naiveAction(state: GameState, me: Player, rng: Rng): CpuAction {
  const legal = enumerateActions(state, me, deriveTurnMemo(state));
  const tokens = legal.filter(a => a.kind === 'selectToken');
  if (tokens.length > 0) return tokens[tokens.length - 1];
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];
  const attacks = legal.filter(a => a.kind === 'attack');
  if (attacks.length > 0) return pick(attacks);
  const forward = legal.filter(a => {
    if (a.kind !== 'move') return false;
    const from = state.pieces.find(p => p.id === a.pieceId)!.pos!;
    return me === 'A' ? a.to.r > from.r : a.to.r < from.r;
  });
  if (forward.length > 0) return pick(forward);
  return { kind: 'endTurn' };
}

describe('niveles 4 y 5: contrato', () => {
  for (const level of [4, 5] as const) {
    it(`nivel ${level}: la accion esta en legal y el turno cierra en <= 25 acciones`, () => {
      for (const seed of [31, 32, 33, 34]) {
        const base = randomPlayState(seed, { turns: seed % 5 });
        const s: GameState = { ...base, selectedNumberToken: null, movementBudgetSpent: 0, attackOrReconUsedThisTurn: false, combatPlaneAttackUsedThisTurn: false };
        const { state, actions } = playTurn(s, s.turn, level, seed, ITER);
        expect(actions.length).toBeLessThanOrEqual(25);
        expect(state.phase === 'handoffPlay' || state.phase === 'finished').toBe(true);
      }
    });

    it(`nivel ${level}: misma semilla e iterations dan la misma accion y las mismas estadisticas de raiz`, () => {
      for (const seed of [3, 5, 8]) {
        const s = randomPlayState(seed, { turns: 4, midTurn: seed % 2 === 1 });
        const a = chooseActionStrict(s, s.turn, level, { rng: mulberry32(11), iterations: ITER });
        const b = chooseActionStrict(s, s.turn, level, { rng: mulberry32(11), iterations: ITER });
        expect(actionKey(b)).toBe(actionKey(a));
        const o1 = searchLevel(level, makeCtx(s, s.turn, 11, { iterations: ITER }));
        const o2 = searchLevel(level, makeCtx(s, s.turn, 11, { iterations: ITER }));
        expect(o2.rootStats).toEqual(o1.rootStats);
        expect(o2.iterations).toBe(o1.iterations);
      }
    });

    it(`nivel ${level}: no-interferencia (la busqueda entera depende solo de la vista)`, () => {
      const report = assertNonInterference(level, [2, 3, 4, 6, 7, 8, 9, 11, 12, 13], { iterations: ITER, scrambles: 2 });
      expect(report.checked).toBeGreaterThan(6);
      expect(report.withHidden).toBeGreaterThan(4);
    });

    it(`nivel ${level}: las estadisticas de la raiz no cambian al permutar los tipos ocultos`, () => {
      for (const seed of [4, 6, 10]) {
        const s = randomPlayState(seed, { turns: 5, midTurn: true });
        if (s.phase !== 'play') continue;
        const me = s.turn;
        const scrambled = scrambleHidden(s, me, mulberry32(seed));
        const o1 = searchLevel(level, makeCtx(s, me, 5, { iterations: ITER }));
        const o2 = searchLevel(level, makeCtx(scrambled, me, 5, { iterations: ITER }));
        expect(o2.rootStats).toEqual(o1.rootStats);
        expect(o2.iterations).toBe(o1.iterations);
      }
    });
  }

  it('el nivel 4 y el 5 no usan Math.random ni Date.now en la logica de busqueda', () => {
    const rnd = Math.random;
    const dnow = Date.now;
    Math.random = () => {
      throw new Error('Math.random en la busqueda');
    };
    Date.now = () => {
      throw new Error('Date.now en la busqueda');
    };
    try {
      const s = randomPlayState(5, { turns: 3 });
      for (const level of [4, 5] as const) expect(() => chooseActionStrict(s, s.turn, level, { rng: mulberry32(1), iterations: 30 })).not.toThrow();
    } finally {
      Math.random = rnd;
      Date.now = dnow;
    }
  });
});

describe('niveles 4 y 5: decisiones', () => {
  it('gana de inmediato si una pieza llega a la zona de llegada con la ficha elegida', () => {
    // El AvionCombate de A esta a dos pasos de la zona de B (filas 19-20, columnas 10-15).
    const s = scenario({ 'A-AvionCombate-0': { r: 17, c: 11 }, 'B-Acorazado-0': { r: 5, c: 5 } }, { selectedNumberToken: 6 });
    for (const level of [4, 5] as const) {
      const a = chooseAction(s, 'A', level, { rng: mulberry32(1), iterations: 20 });
      expect(a).toEqual({ kind: 'move', pieceId: 'A-AvionCombate-0', to: { r: 18, c: 11 } });
      const end = playTurn(s, 'A', level, 1, 20);
      expect(end.state.phase).toBe('finished');
      expect(end.state.winner).toBe('A');
    }
  });

  it('elige la ficha mas chica que alcanza para ganar cuando todavia no eligio ficha', () => {
    const s = scenario({ 'A-AvionCombate-0': { r: 17, c: 11 }, 'B-Acorazado-0': { r: 5, c: 5 } }, { selectedNumberToken: null });
    for (const level of [4, 5] as const) {
      expect(chooseAction(s, 'A', level, { rng: mulberry32(2), iterations: 20 })).toEqual({ kind: 'selectToken', token: 2 });
    }
  });

  it('con la zona un poco mas lejos usa la ficha justa', () => {
    const s = scenario({ 'A-AvionCombate-0': { r: 15, c: 11 }, 'B-Acorazado-0': { r: 5, c: 5 } }, { selectedNumberToken: null });
    for (const level of [4, 5] as const) {
      expect(chooseAction(s, 'A', level, { rng: mulberry32(2), iterations: 20 })).toEqual({ kind: 'selectToken', token: 4 });
    }
  });

  it('ataca a un submarino conocido que tiene a tiro con un AvionCombate', () => {
    const s = scenario(
      { 'A-AvionCombate-0': { r: 10, c: 5 }, 'B-Submarino-0': { r: 10, c: 12 }, 'B-Acorazado-0': { r: 4, c: 20 } },
      { selectedNumberToken: 3 },
      { 'B-Submarino-0': { revealedTo: ['A'] } },
    );
    for (const level of [4, 5] as const) {
      const a = chooseActionStrict(s, 'A', level, { rng: mulberry32(3), iterations: 120 });
      expect(a).toEqual({ kind: 'attack', attackerId: 'A-AvionCombate-0', targetId: 'B-Submarino-0' });
    }
  });

  it('se acerca a la linea de tiro de un crucero rival y lo hunde dentro del mismo turno (mover y atacar)', () => {
    // Crucero contra crucero (alcance igual): hunde. A esta en (10,5); si baja a la fila 12 queda a 4 celdas.
    const s = scenario(
      { 'A-Crucero-0': { r: 10, c: 5 }, 'B-Crucero-0': { r: 12, c: 9 }, 'B-Acorazado-0': { r: 18, c: 20 } },
      { selectedNumberToken: 4 },
      { 'B-Crucero-0': { revealedTo: ['A'] } },
    );
    for (const level of [4, 5] as const) {
      const { state, actions } = playTurn(s, 'A', level, 7, 150);
      const target = state.pieces.find(p => p.id === 'B-Crucero-0')!;
      expect(target.pos).toBeNull();
      expect(actions.some(a => a.kind === 'attack')).toBe(true);
    }
  });

  it('la prior valora atacar a una pieza oculta que corre hacia la zona (aunque en un mundo no sea letal)', () => {
    // Un AvionCombate de A tiene a tiro, en la misma fila, a una pieza enemiga que no conoce.
    const s = scenario(
      { 'A-AvionCombate-0': { r: 12, c: 1 }, 'B-Fragata-0': { r: 12, c: 11 }, 'B-Acorazado-0': { r: 3, c: 3 }, 'A-Fragata-0': { r: 3, c: 20 } },
      { selectedNumberToken: 4 },
    );
    const out = searchLevel(4, makeCtx(s, 'A', 9, { iterations: 200 }));
    const attack = out.rootStats.find(r => r.key.startsWith('a'));
    expect(attack).toBeDefined();
  });
});

describe('niveles 4 y 5: presupuesto y memoria', () => {
  it('respeta el presupuesto por tiempo y siempre hace al menos una iteracion', () => {
    const s = randomPlayState(6, { turns: 3 });
    const t0 = performance.now();
    const out = searchLevel(4, makeCtx(s, s.turn, 1, { timeBudgetMs: 40 }));
    const dt = performance.now() - t0;
    expect(out.iterations).toBeGreaterThan(0);
    expect(dt).toBeLessThan(2000);
    const tiny = searchLevel(5, makeCtx(s, s.turn, 1, { timeBudgetMs: 1 }));
    expect(tiny.iterations).toBeGreaterThan(0);
    expect(makeCtx(s, s.turn, 1).legal.some(a => actionKey(a) === actionKey(tiny.action))).toBe(true);
  });

  it('con iterations e timeBudgetMs a la vez se detiene en el primero que se agota', () => {
    const s = randomPlayState(6, { turns: 3 });
    const out = searchLevel(4, makeCtx(s, s.turn, 1, { iterations: 100000, timeBudgetMs: 30 }));
    expect(out.iterations).toBeLessThan(100000);
    expect(out.iterations).toBeGreaterThan(0);
  });

  it('la parada anticipada no cambia el resultado entre repeticiones y nunca pasa del tope', () => {
    const s = randomPlayState(9, { turns: 4 });
    const a = searchLevel(4, makeCtx(s, s.turn, 4, { iterations: 400 }));
    const b = searchLevel(4, makeCtx(s, s.turn, 4, { iterations: 400 }));
    expect(a.iterations).toBeLessThanOrEqual(400);
    expect(b.iterations).toBe(a.iterations);
    const noStop = searchLevel(4, makeCtx(s, s.turn, 4, { iterations: 400 }), { earlyStop: false, softStopShare: 0 });
    expect(noStop.iterations).toBe(400);
  });

  it('sin memoria cada llamada es independiente; con memoria el nivel 5 reutiliza el arbol dentro del turno', () => {
    const s0 = scenario({ 'A-Fragata-0': { r: 8, c: 12 }, 'B-Acorazado-0': { r: 20, c: 2 } }, { selectedNumberToken: 6 });
    expect(searchMemoryEnabled()).toBe(false);
    const cold = searchLevel(5, makeCtx(s0, 'A', 1, { iterations: 80 }));
    expect(cold.reused).toBe(false);
    expect(cold.action.kind).toBe('move');

    setSearchMemory(true);
    const first = searchLevel(5, makeCtx(s0, 'A', 1, { iterations: 80 }));
    expect(first.reused).toBe(false);
    expect(actionKey(first.action)).toBe(actionKey(cold.action));
    const s1 = applyCpuAction(s0, first.action) as GameState;
    expect(typeof s1).not.toBe('string');
    const second = searchLevel(5, makeCtx(s1, 'A', 2, { iterations: 80 }));
    expect(second.reused).toBe(true);
    expect(makeCtx(s1, 'A', 2).legal.some(a => actionKey(a) === actionKey(second.action))).toBe(true);

    // un estado distinto al esperado no reutiliza nada
    const other = scenario({ 'A-Fragata-0': { r: 9, c: 14 }, 'B-Acorazado-0': { r: 20, c: 2 } }, { selectedNumberToken: 6, movementBudgetSpent: 1 });
    expect(searchLevel(5, makeCtx(other, 'A', 2, { iterations: 40 })).reused).toBe(false);

    // con reuse apagado en la configuracion el arbol nunca se reaprovecha, aunque la memoria este encendida
    searchLevel(4, makeCtx(s0, 'A', 1, { iterations: 40 }), { reuse: false });
    expect(searchLevel(4, makeCtx(s1, 'A', 1, { iterations: 40 }), { reuse: false }).reused).toBe(false);
  });

  it('con la memoria encendida un nivel 5 completo contra el ingenuo no rompe ninguna regla', () => {
    setSearchMemory(true);
    for (const seed of [1, 2]) {
      let state = setupGame(1, 1, seed);
      for (let t = 0; t < 14 && state.phase !== 'finished'; t++) {
        const me = state.turn;
        if (me === 'A') {
          const res = playTurn(state, me, 5, seed * 100 + t, 40);
          state = res.state;
        } else {
          for (let k = 0; k < 40; k++) {
            const a = naiveAction(state, me, mulberry32(seed * 10 + t * 50 + k));
            const next = applyCpuAction(state, a);
            if (typeof next === 'string') throw new Error(next);
            state = next;
            if (a.kind === 'endTurn' || state.phase === 'finished') break;
          }
        }
        if (state.phase === 'handoffPlay') state = confirmHandoff(state);
      }
      expect(state.pieces.filter(p => p.owner === 'A' && p.pos).length).toBeGreaterThan(0);
    }
  });
});

describe('creencias', () => {
  const mineScenario = () =>
    scenario(
      { 'A-Fragata-0': { r: 3, c: 3 }, 'B-Acorazado-0': { r: 9, c: 9 }, 'B-Crucero-0': { r: 12, c: 12 }, 'B-Fragata-0': { r: 14, c: 5 } },
      { selectedNumberToken: 4, mines: [{ r: 9, c: 9, owner: 'B' }] },
    );

  it('una pieza oculta sobre una mina solo puede ser Minador o avion', () => {
    const s = mineScenario();
    const { view } = maskState(s, 'A');
    const allowed = hardAllowed(view);
    expect(allowed).toBeDefined();
    const ids = Object.keys(allowed!);
    expect(ids).toHaveLength(1);
    expect(allowed![ids[0]].sort()).toEqual(['AvionCombate', 'AvionReconocimiento', 'Minador']);

    for (const mode of ['hard', 'weighted'] as const) {
      const sample = makeSampler(view, mode);
      const rng = mulberry32(5);
      for (let i = 0; i < 60; i++) {
        const w = sample(rng);
        const t = w.pieces.find(p => p.id === ids[0])!.type;
        expect(['Minador', 'AvionCombate', 'AvionReconocimiento']).toContain(t);
      }
    }
    // el modo uniforme no restringe: algun mundo la hace barco
    const uniform = makeSampler(view, 'uniform');
    const rng = mulberry32(5);
    let ships = 0;
    for (let i = 0; i < 80; i++) {
      const t = uniform(rng).pieces.find(p => p.id === ids[0])!.type;
      if (t === 'Acorazado' || t === 'Crucero' || t === 'Fragata' || t === 'Submarino') ships++;
    }
    expect(ships).toBeGreaterThan(0);
  });

  it('los mundos muestreados conservan la composicion de la flota rival y no tocan lo visible', () => {
    const s = randomPlayState(12, { turns: 6 });
    const me = s.turn;
    const { view } = maskState(s, me);
    for (const mode of ['uniform', 'hard', 'weighted'] as const) {
      const sample = makeSampler(view, mode);
      const rng = mulberry32(3);
      for (let i = 0; i < 30; i++) {
        const w = sample(rng);
        const counts = Object.fromEntries(UNIT_TYPES.map(t => [t, 0])) as Record<UnitType, number>;
        for (const p of w.pieces) if (p.owner === opp(me)) counts[p.type]++;
        expect(counts).toEqual({ ...FLEET_COUNTS });
        for (const vp of view.pieces) if (vp.type !== null) expect(w.pieces.find(p => p.id === vp.id)!.type).toBe(vp.type);
      }
    }
  });

  it('el seguimiento empareja las piezas ocultas entre turnos y el peso favorece a los aviones en las activas', () => {
    resetTracker();
    const mk = (r: number, c: number, tokens: number[]): GameState =>
      scenario(
        { 'A-Fragata-0': { r: 3, c: 3 }, 'B-Acorazado-0': { r, c }, 'B-Crucero-0': { r: 18, c: 20 } },
        { selectedNumberToken: null, numberTokens: { A: tokens, B: [2, 3] } },
      );
    const seq = [mk(15, 10, [2, 3, 4]), mk(13, 10, [2, 3, 5]), mk(10, 10, [2, 3, 6]), mk(8, 10, [2, 4, 6])];
    for (const st of seq) observeHidden(maskState(st, 'A').view);
    const sample = makeSampler(maskState(seq[3], 'A').view, 'weighted');
    expect(typeof sample).toBe('function');

    const active = { r: 8, c: 10, moves: 9, seen: 3 };
    const still = { r: 8, c: 10, moves: 0, seen: 3 };
    expect(behaviorWeight(active, 'AvionReconocimiento')).toBeGreaterThan(behaviorWeight(active, 'Acorazado'));
    expect(behaviorWeight(still, 'Acorazado')).toBeGreaterThan(behaviorWeight(still, 'AvionReconocimiento'));
    expect(behaviorWeight(undefined, 'Crucero')).toBe(1);
    expect(behaviorWeight({ r: 1, c: 1, moves: 5, seen: 1 }, 'Crucero')).toBe(1);
  });
});

describe('fuerza', () => {
  it('el nivel 4 gana al rival ingenuo en ambos lados', () => {
    let wins = 0;
    let games = 0;
    for (const seed of [1, 2]) {
      for (const l4IsA of [true, false]) {
        let state = setupGame(1, 1, seed);
        for (let t = 0; t < 80 && state.phase !== 'finished'; t++) {
          const me = state.turn;
          if ((me === 'A') === l4IsA) {
            state = playTurn(state, me, 4, seed * 1000 + t, 40).state;
          } else {
            for (let k = 0; k < 40; k++) {
              const a = naiveAction(state, me, mulberry32(seed * 7 + t * 60 + k));
              const next = applyCpuAction(state, a);
              if (typeof next === 'string') throw new Error(next);
              state = next;
              if (a.kind === 'endTurn' || state.phase === 'finished') break;
            }
          }
          if (state.phase === 'handoffPlay') state = confirmHandoff(state);
        }
        games++;
        if (state.winner === (l4IsA ? 'A' : 'B')) wins++;
      }
    }
    expect(wins).toBeGreaterThanOrEqual(games - 1);
  });

  it('las configuraciones separan los niveles por presupuesto y profundidad', () => {
    expect(L5_CONFIG.defaultTimeMs).toBeGreaterThan(L4_CONFIG.defaultTimeMs * 2);
    expect(L5_CONFIG.horizonEnds).toBeGreaterThan(L4_CONFIG.horizonEnds);
    expect(L5_CONFIG.reuse).toBe(true);
    expect(L5_CONFIG.maxNodes).toBeGreaterThan(L4_CONFIG.maxNodes);
    expect(L5_CONFIG.belief).toBe('weighted');
    expect(L4_CONFIG.belief).toBe('hard');
  });
});
