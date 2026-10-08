import { describe, expect, it } from 'vitest';
import type { GameState, Piece, Player } from '../engine/types';
import type { CpuAction } from '../ai/types';
import { confirmHandoff, createInitialState } from '../engine/gameEngine';
import { applyCpuAction } from '../ai/actions';
import { chooseAction, chooseActionStrict } from '../ai';
import { mulberry32 } from '../ai/rng';
import { maskedView } from '../ai/view';
import { budgetFor, DEFAULT_ITERATIONS, findWinPlan, moverWinners, turnSeed } from '../ai/levels/turnplan';
import { assertNonInterference, playGame, randomPlayState } from './ai.helpers';

const FAST = 24;
/** Margen para maquinas cargadas: el tiempo por defecto de vitest (5 s) queda corto con varios agentes corriendo. */
const SLOW = 60_000;

/** Estado de juego con solo las piezas indicadas en el tablero (el resto queda destruido). */
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
    selectedNumberToken: null,
    numberTokens: { A: [2, 3, 4, 5, 6], B: [2, 3, 4, 5, 6] },
    pieces: base.pieces.map(p => ({ ...p, pos: placed[p.id] ?? null, ...pieceOver[p.id] })),
    ...over,
  };
}

interface TurnResult {
  state: GameState;
  actions: CpuAction[];
}

/** Juega con el nivel 3 hasta que cierra el turno (o gana). Lanza si el motor rechaza una accion. */
function playTurn(start: GameState, opts: { iterations?: number; seed?: number } = {}): TurnResult {
  let state = start;
  const me = state.turn;
  const actions: CpuAction[] = [];
  for (let i = 0; i < 30; i++) {
    const a = chooseActionStrict(state, me, 3, { rng: mulberry32((opts.seed ?? 1) + i), iterations: opts.iterations });
    const next = applyCpuAction(state, a);
    if (typeof next === 'string') throw new Error(`Accion rechazada (${next}): ${JSON.stringify(a)}`);
    actions.push(a);
    state = next;
    if (state.phase === 'finished' || a.kind === 'endTurn') return { state, actions };
  }
  throw new Error('El turno no termina');
}

describe('nivel 3: un turno completo', () => {
  it('siempre elige acciones que el motor acepta y cierra el turno con la ficha elegida primero', () => {
    for (const [iterations, seeds] of [[FAST, 8], [60, 4]] as const) {
      for (let seed = 1; seed <= seeds; seed++) {
        const s0 = randomPlayState(seed, { turns: seed % 6 });
        const start: GameState = { ...s0, selectedNumberToken: null, movementBudgetSpent: 0, attackOrReconUsedThisTurn: false, combatPlaneAttackUsedThisTurn: false };
        if (start.phase !== 'play') continue;
        const { state, actions } = playTurn(start, { iterations, seed });
        expect(actions[0].kind).toBe('selectToken');
        expect(actions.length).toBeLessThanOrEqual(12);
        expect(state.phase === 'handoffPlay' || state.phase === 'finished').toBe(true);
        expect(actions.filter(a => a.kind === 'selectToken')).toHaveLength(1);
        expect(actions.filter(a => a.kind === 'attack' || a.kind === 'recon').length).toBeLessThanOrEqual(1);
        expect(actions.filter(a => a.kind === 'placeMine' || a.kind === 'liftMine').length).toBeLessThanOrEqual(1);
        expect(actions.some(a => a.kind === 'liftMine')).toBe(false);
      }
    }
  }, SLOW);

  it('continua un turno a medias sin repetir la eleccion de ficha', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = randomPlayState(seed, { turns: 2 + (seed % 5), midTurn: true });
      if (s.phase !== 'play') continue;
      const { actions } = playTurn(s, { iterations: FAST, seed });
      expect(actions.some(a => a.kind === 'selectToken')).toBe(s.selectedNumberToken === null);
      expect(actions.length).toBeGreaterThan(0);
    }
  }, SLOW);

  it('es determinista: depende solo de la vista, no del rng inyectado', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = randomPlayState(seed, { turns: 1 + (seed % 5), midTurn: seed % 2 === 0 });
      if (s.phase !== 'play') continue;
      const first = chooseActionStrict(s, s.turn, 3, { rng: mulberry32(1), iterations: 48 });
      expect(chooseActionStrict(s, s.turn, 3, { rng: mulberry32(1), iterations: 48 })).toEqual(first);
      expect(chooseActionStrict(s, s.turn, 3, { rng: mulberry32(999), iterations: 48 })).toEqual(first);
      expect(chooseActionStrict(s, s.turn, 3, { iterations: 48 })).toEqual(first);
    }
  }, SLOW);

  it('no muta el estado que recibe', () => {
    const s = randomPlayState(5, { turns: 4, midTurn: true });
    const copy = structuredClone(s);
    chooseAction(s, s.turn, 3, { iterations: 60 });
    expect(s).toEqual(copy);
  });

  it('no lanza y devuelve endTurn fuera de su turno o con la partida terminada', () => {
    const s = randomPlayState(8, { turns: 2 });
    expect(chooseAction(s, s.turn === 'A' ? 'B' : 'A', 3)).toEqual({ kind: 'endTurn' });
    expect(chooseAction({ ...s, phase: 'finished' }, s.turn, 3)).toEqual({ kind: 'endTurn' });
  });

  it('tarda poco: una accion con el presupuesto por defecto en pocos cientos de milisegundos', () => {
    const times: number[] = [];
    for (const seed of [3, 6, 9, 12]) {
      const s = randomPlayState(seed, { turns: 3 + (seed % 4) });
      if (s.phase !== 'play') continue;
      const t0 = performance.now();
      chooseAction(s, s.turn, 3);
      times.push(performance.now() - t0);
    }
    expect(times.length).toBeGreaterThan(2);
    expect(Math.max(...times)).toBeLessThan(1500);
  }, SLOW);
});

describe('nivel 3: no interferencia', () => {
  it('con el presupuesto de las pruebas rapidas', () => {
    const report = assertNonInterference(3, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], { iterations: FAST, scrambles: 2 });
    expect(report.checked).toBeGreaterThan(8);
    expect(report.withHidden).toBeGreaterThan(5);
  }, SLOW);

  it('con preseleccion, finalistas y respuesta del rival activos', () => {
    const report = assertNonInterference(3, [2, 4, 6, 8, 10, 13], { iterations: 72, scrambles: 2 });
    expect(report.checked).toBeGreaterThan(3);
    expect(report.withHidden).toBeGreaterThan(2);
  }, SLOW);
});

describe('nivel 3: tacticas', () => {
  it('ve la victoria en dos pasos: elige la ficha 2 y llega a la zona de llegada', () => {
    const s = scenario({ 'A-Fragata-0': { r: 17, c: 15 }, 'B-Fragata-0': { r: 3, c: 3 } });
    const { state, actions } = playTurn(s, { iterations: FAST });
    expect(actions).toEqual([
      { kind: 'selectToken', token: 2 },
      { kind: 'move', pieceId: 'A-Fragata-0', to: { r: 18, c: 15 } },
      { kind: 'move', pieceId: 'A-Fragata-0', to: { r: 19, c: 15 } },
    ]);
    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('A');
  });

  it('con la ficha ya elegida sigue el camino hacia la victoria', () => {
    const s = scenario({ 'B-Minador-0': { r: 4, c: 14 }, 'A-Fragata-0': { r: 10, c: 3 } }, { turn: 'B', selectedNumberToken: 3 });
    const { state, actions } = playTurn(s, { iterations: FAST });
    expect(actions).toEqual([
      { kind: 'move', pieceId: 'B-Minador-0', to: { r: 3, c: 14 } },
      { kind: 'move', pieceId: 'B-Minador-0', to: { r: 2, c: 14 } },
    ]);
    expect(state.winner).toBe('B');
  });

  it('el avion de combate ataca antes de mover y hunde al submarino alineado', () => {
    const s = scenario({
      'A-AvionCombate-0': { r: 3, c: 10 },
      'A-Fragata-0': { r: 4, c: 20 },
      'B-Submarino-0': { r: 12, c: 10 },
      'B-Fragata-0': { r: 16, c: 20 },
    });
    const { state, actions } = playTurn(s, { iterations: 60 });
    const first = actions.find(a => a.kind !== 'selectToken') as CpuAction;
    expect(first).toEqual({ kind: 'attack', attackerId: 'A-AvionCombate-0', targetId: 'B-Submarino-0' });
    expect(state.pieces.find(p => p.id === 'B-Submarino-0')!.pos).toBeNull();
    expect(actions.slice(1).filter(a => a.kind === 'attack')).toHaveLength(1);
  });

  it('reconoce con el avion de reconocimiento antes de seguir moviendo', () => {
    const s = scenario({
      'A-AvionReconocimiento-0': { r: 3, c: 10 },
      'A-Fragata-0': { r: 4, c: 5 },
      'B-Fragata-0': { r: 12, c: 10 },
    });
    const { actions } = playTurn(s, { iterations: 60 });
    const first = actions.find(a => a.kind !== 'selectToken') as CpuAction;
    expect(first.kind).toBe('recon');
  });

  it('frena al corredor rival que ganaria en su turno: mueve y daña con la fragata', () => {
    const s = scenario({ 'A-Crucero-0': { r: 15, c: 15 }, 'B-Fragata-0': { r: 15, c: 12 } }, { turn: 'B' });
    for (const iterations of [FAST, 96]) {
      expect(moverWinners({ ...s, turn: 'A' }, 'A')).toHaveLength(1);
      const { state, actions } = playTurn(s, { iterations });
      expect(actions.some(a => a.kind === 'attack')).toBe(true);
      const runner = state.pieces.find(p => p.id === 'A-Crucero-0')!;
      expect(runner.damaged || runner.pos === null).toBe(true);
      expect(moverWinners(confirmHandoff(state), 'A')).toEqual([]);
    }
  }, SLOW);

  it('frena al corredor con una mina cuando es lo unico que queda por hacer', () => {
    const s = scenario(
      { 'A-Acorazado-0': { r: 13, c: 15 }, 'B-Minador-0': { r: 14, c: 14 } },
      { turn: 'B', selectedNumberToken: 2, movementBudgetSpent: 2, attackOrReconUsedThisTurn: true },
    );
    expect(moverWinners({ ...s, turn: 'A', selectedNumberToken: null }, 'A')).toHaveLength(1);
    const { state, actions } = playTurn(s, { iterations: 96 });
    expect(actions[0]).toEqual({ kind: 'placeMine', pieceId: 'B-Minador-0', at: { r: 14, c: 15 } });
    expect(moverWinners(confirmHandoff(state), 'A')).toEqual([]);
  }, SLOW);

  it('frena al corredor acercando un barco hasta tocarlo cuando solo asi se lo derriba', () => {
    const s = scenario(
      {
        'A-AvionCombate-0': { r: 13, c: 15 },
        'B-Acorazado-0': { r: 14, c: 13 },
        'B-Fragata-0': { r: 3, c: 3 },
      },
      { turn: 'B' },
    );
    expect(moverWinners({ ...s, turn: 'A', phase: 'play' }, 'A')).toHaveLength(1);
    const { state } = playTurn(s, { iterations: 96 });
    expect(moverWinners(confirmHandoff(state), 'A')).toEqual([]);
  }, SLOW);
});

describe('nivel 3: deteccion de victoria', () => {
  it('moverWinners cuenta que un avion derribe de un disparo inmovil a su bloqueador, pero no a un barco', () => {
    const planeBlock = scenario({ 'A-AvionCombate-0': { r: 13, c: 15 }, 'B-AvionCombate-0': { r: 17, c: 15 } });
    expect(moverWinners(planeBlock, 'A')).toEqual([planeBlock.pieces.findIndex(p => p.id === 'A-AvionCombate-0')]);
    const shipBlock = scenario({ 'A-AvionCombate-0': { r: 13, c: 15 }, 'B-Fragata-0': { r: 17, c: 15 } });
    expect(moverWinners(shipBlock, 'A')).toEqual([]);
  });

  it('moverWinners respeta las minas segun el tipo de pieza', () => {
    const mines = [{ r: 17, c: 15, owner: 'B' as Player }, { r: 17, c: 14, owner: 'B' as Player }, { r: 17, c: 16, owner: 'B' as Player }];
    const ship = scenario({ 'A-Crucero-0': { r: 14, c: 15 } }, { mines });
    expect(moverWinners(ship, 'A')).toEqual([]);
    const plane = scenario({ 'A-AvionCombate-0': { r: 14, c: 15 } }, { mines });
    expect(moverWinners(plane, 'A')).toHaveLength(1);
  });

  it('findWinPlan da el camino mas corto, esquiva minas y respeta el presupuesto y la averia', () => {
    const s = scenario({ 'A-Fragata-0': { r: 15, c: 15 }, 'B-Fragata-0': { r: 3, c: 3 } });
    const view = maskedView(s, 'A');
    const plan = findWinPlan(view, 'A', 6)!;
    expect(plan.pieceId).toBe('A-Fragata-0');
    expect(plan.cost).toBe(4);
    expect(plan.path[plan.path.length - 1]).toEqual({ r: 19, c: 15 });
    expect(findWinPlan(view, 'A', 3)).toBeNull();

    const mined = scenario({ 'A-Fragata-0': { r: 15, c: 15 }, 'B-Fragata-0': { r: 3, c: 3 } }, { mines: [{ r: 16, c: 15, owner: 'B' }] });
    const around = findWinPlan(maskedView(mined, 'A'), 'A', 6)!;
    expect(around.cost).toBe(5);
    expect(around.path[0]).not.toEqual({ r: 16, c: 15 });

    const damaged = scenario({ 'A-Fragata-0': { r: 15, c: 15 } }, {}, { 'A-Fragata-0': { damaged: true } });
    expect(findWinPlan(maskedView(damaged, 'A'), 'A', 6)).toBeNull();
    expect(findWinPlan(maskedView(damaged, 'A'), 'A', 8)!.cost).toBe(8);
  });
});

describe('nivel 3: presupuesto y semilla', () => {
  it('budgetFor crece con las iteraciones y respeta los topes', () => {
    const lo = budgetFor(24);
    const mid = budgetFor(96);
    const hi = budgetFor(10_000);
    for (const key of ['worlds', 'beam', 'breadth'] as const) {
      expect(lo[key]).toBeLessThanOrEqual(mid[key]);
      expect(mid[key]).toBeLessThanOrEqual(hi[key]);
      expect(lo[key]).toBeGreaterThanOrEqual(1);
    }
    expect(budgetFor()).toEqual(budgetFor(DEFAULT_ITERATIONS));
    expect(hi.worlds).toBeLessThanOrEqual(12);
    expect(budgetFor(0).worlds).toBeGreaterThanOrEqual(1);
  });

  it('la semilla de los mundos no cambia mientras el rival no se mueve, aunque yo mueva', () => {
    const s = scenario({ 'A-Fragata-0': { r: 5, c: 5 }, 'A-Crucero-0': { r: 6, c: 9 }, 'B-Fragata-0': { r: 15, c: 15 } }, { selectedNumberToken: 6 });
    const moved = applyCpuAction(s, { kind: 'move', pieceId: 'A-Fragata-0', to: { r: 6, c: 5 } }) as GameState;
    expect(turnSeed(maskedView(moved, 'A'))).toBe(turnSeed(maskedView(s, 'A')));
    const enemyMoved = { ...s, pieces: s.pieces.map(p => (p.id === 'B-Fragata-0' ? { ...p, pos: { r: 14, c: 15 } } : p)) };
    expect(turnSeed(maskedView(enemyMoved, 'A'))).not.toBe(turnSeed(maskedView(s, 'A')));
  });
});

describe('nivel 3 contra nivel 2', () => {
  it('gana una serie corta con semillas fijas (ambos lados)', () => {
    let wins3 = 0;
    let wins2 = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const asA = playGame(3, 2, seed, { maxTurns: 60, iterations: FAST });
      const asB = playGame(2, 3, seed, { maxTurns: 60, iterations: FAST });
      if (asA.winner === 'A') wins3++;
      else if (asA.winner === 'B') wins2++;
      if (asB.winner === 'B') wins3++;
      else if (asB.winner === 'A') wins2++;
    }
    expect(wins3).toBeGreaterThan(wins2);
    expect(wins3).toBeGreaterThanOrEqual(7);
  }, SLOW);
});
