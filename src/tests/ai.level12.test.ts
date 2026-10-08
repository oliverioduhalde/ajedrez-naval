import { describe, expect, it } from 'vitest';
import type { GameState, Piece, Player, UnitType } from '../engine/types';
import type { CpuAction, CpuLevel } from '../ai/types';
import { getCellKind, getSetupCells } from '../engine/board';
import { confirmHandoff, createInitialState, finishSetup } from '../engine/gameEngine';
import { applyCpuAction, applyPlacements } from '../ai/actions';
import { chooseAction, chooseActionStrict, chooseSetup, chooseSetupStrict } from '../ai';
import { goalDistance } from '../ai/evaluate';
import { mulberry32 } from '../ai/rng';
import { assertNonInterference, playGame, randomPlayState } from './ai.helpers';

const LEVELS: CpuLevel[] = [1, 2, 3, 4, 5];
const PLAYERS: Player[] = ['A', 'B'];
const ITER = 3;

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

/** Juega un turno completo de `me` con el nivel dado y devuelve cuantas acciones uso y el estado final. */
function playOneTurn(state: GameState, level: CpuLevel, seed: number): { actions: CpuAction[]; state: GameState } {
  const me = state.turn;
  const actions: CpuAction[] = [];
  let cur = state;
  for (let i = 0; i < 40; i++) {
    const a = chooseActionStrict(cur, me, level, { rng: mulberry32(seed * 977 + i), iterations: ITER });
    const next = applyCpuAction(cur, a);
    if (typeof next === 'string') throw new Error(`Accion rechazada (${next}): ${JSON.stringify(a)}`);
    actions.push(a);
    cur = next;
    if (a.kind === 'endTurn' || cur.phase === 'finished') return { actions, state: cur };
  }
  throw new Error('El turno no termina');
}

function depthOf(player: Player, r: number): number {
  return player === 'A' ? r - 1 : 20 - r;
}

function layoutFor(level: CpuLevel, seed: number): GameState {
  let state = createInitialState();
  for (const me of PLAYERS) {
    const placements = chooseSetupStrict(state, me, level, { rng: mulberry32(seed * 10 + (me === 'A' ? 1 : 2)) });
    const placed = applyPlacements(state, placements);
    if (typeof placed === 'string') throw new Error(placed);
    const done = finishSetup(placed);
    if (typeof done === 'string') throw new Error(done);
    state = done;
  }
  return state;
}

describe('nivel 1 GRUMETE', () => {
  it('siempre devuelve una accion legal y termina el turno en pocas acciones', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = randomPlayState(seed, { turns: 1 + (seed % 6), midTurn: seed % 3 === 0 });
      if (state.phase !== 'play') continue;
      const { actions } = playOneTurn(state, 1, seed);
      expect(actions.length).toBeLessThanOrEqual(25);
      expect(actions[actions.length - 1].kind).toBe('endTurn');
    }
  });

  it('es determinista dada la semilla y varia con otra', () => {
    const state = randomPlayState(5, { turns: 2 });
    const me = state.turn;
    const a1 = chooseActionStrict(state, me, 1, { rng: mulberry32(7) });
    const a2 = chooseActionStrict(state, me, 1, { rng: mulberry32(7) });
    expect(a2).toEqual(a1);
    const distinct = new Set<string>();
    for (let s = 1; s <= 30; s++) distinct.add(JSON.stringify(chooseActionStrict(state, me, 1, { rng: mulberry32(s) })));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('ataca de vez en cuando, avanza mas de lo que retrocede y a veces termina el turno antes de tiempo', () => {
    const state = scenario({
      'A-Crucero-0': { r: 10, c: 12 },
      'A-Fragata-0': { r: 10, c: 8 },
      'B-Fragata-0': { r: 10, c: 14 },
    });
    const counts = { attack: 0, endTurn: 0, forward: 0, backward: 0, total: 600 };
    for (let s = 1; s <= counts.total; s++) {
      const a = chooseActionStrict(state, 'A', 1, { rng: mulberry32(s) });
      if (a.kind === 'attack') counts.attack++;
      else if (a.kind === 'endTurn') counts.endTurn++;
      else if (a.kind === 'move') {
        const from = state.pieces.find(p => p.id === a.pieceId)!.pos!;
        const delta = goalDistance('A', a.to.r, a.to.c) - goalDistance('A', from.r, from.c);
        if (delta < 0) counts.forward++;
        else if (delta > 0) counts.backward++;
      }
    }
    expect(counts.attack / counts.total).toBeGreaterThan(0.02);
    expect(counts.attack / counts.total).toBeLessThan(0.5);
    expect(counts.endTurn / counts.total).toBeGreaterThan(0.01);
    expect(counts.endTurn / counts.total).toBeLessThan(0.4);
    expect(counts.forward).toBeGreaterThan(counts.backward * 2);
    expect(counts.backward).toBeGreaterThan(0);
  });

  it('esquiva (con alta probabilidad) las celdas bajo fuego de un enemigo ya identificado', () => {
    const state = scenario(
      { 'A-Fragata-0': { r: 10, c: 12 }, 'B-Acorazado-0': { r: 10, c: 19 } },
      {},
      { 'B-Acorazado-0': { revealedTo: ['A'] } },
    );
    let toExposed = 0;
    let toSafe = 0;
    for (let s = 1; s <= 800; s++) {
      const a = chooseActionStrict(state, 'A', 1, { rng: mulberry32(s) });
      if (a.kind !== 'move') continue;
      if (a.to.r === 10 && a.to.c === 13) toExposed++;
      if (a.to.r === 10 && a.to.c === 11) toSafe++;
    }
    expect(toSafe).toBeGreaterThan(toExposed * 2);
  });

  it('las partidas entre dos GRUMETES avanzan hasta terminar', () => {
    for (const seed of [1, 2]) {
      const game = playGame(1, 1, seed, { maxTurns: 320 });
      expect(game.state.phase).toBe('finished');
      expect(game.winner).not.toBeNull();
      expect(game.turns).toBeGreaterThan(10);
    }
  });

  it('no interfiere con la informacion oculta del rival', () => {
    const report = assertNonInterference(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { scrambles: 2 });
    expect(report.checked).toBeGreaterThan(5);
    expect(report.withHidden).toBeGreaterThan(0);
  });
});

describe('nivel 2 MARINERO', () => {
  it('siempre devuelve una accion legal y termina el turno en pocas acciones', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = randomPlayState(seed, { turns: 1 + (seed % 6), midTurn: seed % 3 === 0 });
      if (state.phase !== 'play') continue;
      const { actions } = playOneTurn(state, 2, seed);
      expect(actions.length).toBeLessThanOrEqual(25);
      expect(actions[actions.length - 1].kind).toBe('endTurn');
    }
  });

  it('es determinista dada la semilla', () => {
    const state = randomPlayState(9, { turns: 3 });
    const me = state.turn;
    const a1 = chooseActionStrict(state, me, 2, { rng: mulberry32(11), iterations: ITER });
    const a2 = chooseActionStrict(state, me, 2, { rng: mulberry32(11), iterations: ITER });
    expect(a2).toEqual(a1);
  });

  it('elige la ficha mas alta', () => {
    const state = scenario({ 'A-Crucero-0': { r: 8, c: 12 }, 'B-Fragata-0': { r: 16, c: 3 } }, { selectedNumberToken: null });
    expect(chooseActionStrict(state, 'A', 2, { rng: mulberry32(1) })).toEqual({ kind: 'selectToken', token: 6 });
    const few = scenario(
      { 'A-Crucero-0': { r: 8, c: 12 }, 'B-Fragata-0': { r: 16, c: 3 } },
      { selectedNumberToken: null, numberTokens: { A: [2, 3, 5], B: [4, 6] } },
    );
    expect(chooseActionStrict(few, 'A', 2, { rng: mulberry32(1) })).toEqual({ kind: 'selectToken', token: 5 });
  });

  it('si puede ganar este turno, gana', () => {
    const state = scenario(
      { 'A-Crucero-0': { r: 18, c: 11 }, 'B-Acorazado-0': { r: 14, c: 3 } },
      { selectedNumberToken: 3 },
    );
    const a = chooseActionStrict(state, 'A', 2, { rng: mulberry32(2), iterations: ITER });
    expect(a).toEqual({ kind: 'move', pieceId: 'A-Crucero-0', to: { r: 19, c: 11 } });
  });

  it('ataca un blanco identificado que puede hundir', () => {
    const state = scenario(
      { 'A-AvionCombate-0': { r: 10, c: 5 }, 'B-Submarino-0': { r: 10, c: 12 }, 'B-Acorazado-0': { r: 16, c: 20 } },
      { selectedNumberToken: 4, movementBudgetSpent: 0 },
      { 'B-Submarino-0': { revealedTo: ['A'] } },
    );
    const a = chooseActionStrict(state, 'A', 2, { rng: mulberry32(3), iterations: ITER });
    expect(a).toEqual({ kind: 'attack', attackerId: 'A-AvionCombate-0', targetId: 'B-Submarino-0' });
  });

  it('ataca con su acorazado a un barco oculto a tiro (el valor esperado es positivo)', () => {
    const state = scenario(
      { 'A-Acorazado-0': { r: 10, c: 12 }, 'B-Fragata-0': { r: 10, c: 16 }, 'B-Acorazado-0': { r: 17, c: 2 } },
      { selectedNumberToken: 4, movementBudgetSpent: 4 },
    );
    const a = chooseActionStrict(state, 'A', 2, { rng: mulberry32(4), iterations: ITER });
    expect(a.kind).toBe('attack');
  });

  it('usa el avion de reconocimiento para identificar una pieza oculta', () => {
    const state = scenario(
      { 'A-AvionReconocimiento-0': { r: 10, c: 5 }, 'B-Fragata-0': { r: 10, c: 9 }, 'B-Acorazado-0': { r: 18, c: 20 } },
      { selectedNumberToken: 2, movementBudgetSpent: 2 },
    );
    const a = chooseActionStrict(state, 'A', 2, { rng: mulberry32(5), iterations: ITER });
    expect(a).toEqual({ kind: 'recon', pieceId: 'A-AvionReconocimiento-0', targetId: 'B-Fragata-0' });
  });

  it('no gasta el reconocimiento en piezas que ya conoce', () => {
    const state = scenario(
      { 'A-AvionReconocimiento-0': { r: 10, c: 5 }, 'B-Fragata-0': { r: 10, c: 9 } },
      { selectedNumberToken: 2, movementBudgetSpent: 2 },
      { 'B-Fragata-0': { revealedTo: ['A'] } },
    );
    expect(chooseActionStrict(state, 'A', 2, { rng: mulberry32(6), iterations: ITER })).toEqual({ kind: 'endTurn' });
  });

  it('solo siembra minas en el cinturon delante de su zona y nunca levanta las propias', () => {
    const exhausted = { selectedNumberToken: 2, movementBudgetSpent: 2 };
    const nearZone = scenario({ 'A-Minador-0': { r: 3, c: 12 }, 'B-Fragata-0': { r: 16, c: 3 } }, exhausted);
    for (let s = 1; s <= 5; s++) {
      const a = chooseActionStrict(nearZone, 'A', 2, { rng: mulberry32(s), iterations: ITER });
      if (a.kind === 'placeMine') expect(goalDistance('B', a.at.r, a.at.c)).toBeGreaterThanOrEqual(3);
    }

    const belt = scenario({ 'A-Minador-0': { r: 4, c: 12 }, 'B-Fragata-0': { r: 16, c: 3 } }, exhausted);
    const sown = chooseActionStrict(belt, 'A', 2, { rng: mulberry32(7), iterations: ITER });
    if (sown.kind === 'placeMine') {
      expect(goalDistance('B', sown.at.r, sown.at.c)).toBeGreaterThanOrEqual(3);
      expect(goalDistance('B', sown.at.r, sown.at.c)).toBeLessThanOrEqual(6);
    }

    const own = scenario(
      { 'A-Minador-0': { r: 14, c: 5 }, 'B-Fragata-0': { r: 16, c: 3 } },
      { ...exhausted, mines: [{ r: 13, c: 5, owner: 'A' }] },
    );
    expect(chooseActionStrict(own, 'A', 2, { rng: mulberry32(8), iterations: ITER })).toEqual({ kind: 'endTurn' });
  });

  it('le gana al nivel 1 en una serie corta, jugando de ambos lados', () => {
    let wins = 0;
    const seeds = [1, 2, 3];
    for (const seed of seeds) {
      const asA = playGame(2, 1, seed, { maxTurns: 250, iterations: ITER });
      if (asA.winner === 'A') wins++;
      const asB = playGame(1, 2, seed, { maxTurns: 250, iterations: ITER });
      if (asB.winner === 'B') wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
  });

  it('no interfiere con la informacion oculta del rival', () => {
    const report = assertNonInterference(2, [1, 2, 3, 4, 5, 6, 7, 8], { iterations: ITER, scrambles: 2 });
    expect(report.checked).toBeGreaterThan(4);
    expect(report.withHidden).toBeGreaterThan(0);
  });
});

describe('despliegue (planSetup) de los cinco niveles', () => {
  it('es valido para el motor, con 16 piezas en celdas distintas de la franja propia, para ambos jugadores', () => {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 6; seed++) {
        const base = createInitialState();
        const afterA = (() => {
          const pl = chooseSetupStrict(base, 'A', level, { rng: mulberry32(seed) });
          const placed = applyPlacements(base, pl);
          if (typeof placed === 'string') throw new Error(placed);
          const done = finishSetup(placed);
          if (typeof done === 'string') throw new Error(done);
          return { done, pl };
        })();
        const plB = chooseSetupStrict(afterA.done, 'B', level, { rng: mulberry32(seed + 100) });

        for (const [me, pl] of [
          ['A', afterA.pl],
          ['B', plB],
        ] as const) {
          expect(pl).toHaveLength(16);
          expect(new Set(pl.map(p => p.pieceId)).size).toBe(16);
          expect(new Set(pl.map(p => `${p.pos.r},${p.pos.c}`)).size).toBe(16);
          const strip = new Set(getSetupCells(me).map(c => `${c.r},${c.c}`));
          for (const p of pl) {
            expect(strip.has(`${p.pos.r},${p.pos.c}`)).toBe(true);
            expect(p.pieceId.startsWith(`${me}-`)).toBe(true);
          }
        }
      }
    }
  });

  it('chooseSetup (la version que no lanza) devuelve el mismo despliegue valido', () => {
    const state = createInitialState();
    for (const level of LEVELS) {
      const strict = chooseSetupStrict(state, 'A', level, { rng: mulberry32(level) });
      expect(chooseSetup(state, 'A', level, { rng: mulberry32(level) })).toEqual(strict);
    }
  });

  it('es determinista dada la semilla y varia con otra', () => {
    const state = createInitialState();
    for (const level of LEVELS) {
      const a = chooseSetupStrict(state, 'A', level, { rng: mulberry32(42) });
      const b = chooseSetupStrict(state, 'A', level, { rng: mulberry32(42) });
      expect(b).toEqual(a);
      const c = chooseSetupStrict(state, 'A', level, { rng: mulberry32(43) });
      expect(c).not.toEqual(a);
    }
  });

  it('no depende de la verdad oculta del rival (B mira posiciones, no identidades)', () => {
    const afterA = layoutFor(5, 3);
    const awaitingB: GameState = {
      ...afterA,
      phase: 'setupB',
      setupPlayer: 'B',
      pieces: afterA.pieces.map(p => (p.owner === 'B' ? { ...p, pos: null } : p)),
    };
    const otherTruth: GameState = {
      ...awaitingB,
      pieces: awaitingB.pieces.map(p => (p.owner === 'A' ? { ...p, type: 'Fragata' as UnitType } : p)),
    };
    expect(chooseSetupStrict(otherTruth, 'B', 5, { rng: mulberry32(9) })).toEqual(
      chooseSetupStrict(awaitingB, 'B', 5, { rng: mulberry32(9) }),
    );
  });

  it('nivel 5: acorazado al frente, aviones atras con la columna libre, submarinos junto a fragatas, un solo grupo', () => {
    let boards = 0;
    let acorazadoFront = 0;
    let planeDepth = 0;
    let planes = 0;
    let planesBlockedByOwn = 0;
    let crucerosDepth = 0;
    let cruceros = 0;
    let subs = 0;
    let subsPaired = 0;
    let connected = 0;
    let minadoresNearDock = 0;
    let minadores = 0;

    for (let seed = 1; seed <= 20; seed++) {
      const state = layoutFor(5, seed);
      for (const me of PLAYERS) {
        const mine = state.pieces.filter(p => p.owner === me);
        const fwd = me === 'A' ? 1 : -1;
        boards++;
        const acorazado = mine.find(p => p.type === 'Acorazado')!;
        if (depthOf(me, acorazado.pos!.r) >= 5) acorazadoFront++;
        for (const p of mine) {
          const { r, c } = p.pos!;
          if (p.type === 'Crucero') {
            cruceros++;
            crucerosDepth += depthOf(me, r);
          }
          if (p.type === 'AvionCombate' || p.type === 'AvionReconocimiento') {
            planes++;
            planeDepth += depthOf(me, r);
            const enemyFront = me === 'A' ? 14 : 7;
            for (let rr = r + fwd; rr >= 1 && rr <= 20; rr += fwd) {
              if (mine.some(q => q.pos!.r === rr && q.pos!.c === c)) {
                planesBlockedByOwn++;
                break;
              }
              if (rr === enemyFront) break;
            }
          }
          if (p.type === 'Submarino') {
            subs++;
            if (mine.some(q => q.type === 'Fragata' && Math.abs(q.pos!.r - r) + Math.abs(q.pos!.c - c) <= 2)) subsPaired++;
          }
          if (p.type === 'Minador') {
            minadores++;
            const workshopRow = me === 'A' ? 1 : 20;
            const toDock = Math.abs(r - workshopRow) + Math.min(Math.abs(c - 12), Math.abs(c - 13));
            if (toDock <= 6) minadoresNearDock++;
          }
        }
        const seen = new Set([mine[0].id]);
        const queue = [mine[0]];
        for (let h = 0; h < queue.length; h++) {
          for (const o of mine) {
            const d = Math.abs(o.pos!.r - queue[h].pos!.r) + Math.abs(o.pos!.c - queue[h].pos!.c);
            if (!seen.has(o.id) && d <= 2) {
              seen.add(o.id);
              queue.push(o);
            }
          }
        }
        if (seen.size === mine.length) connected++;
      }
    }

    expect(acorazadoFront / boards).toBeGreaterThanOrEqual(0.95);
    expect(planeDepth / planes).toBeLessThan(3.5);
    expect(crucerosDepth / cruceros - planeDepth / planes).toBeGreaterThan(2);
    expect(planesBlockedByOwn / planes).toBeLessThan(0.2);
    expect(subsPaired / subs).toBeGreaterThanOrEqual(0.95);
    expect(connected / boards).toBeGreaterThanOrEqual(0.95);
    expect(minadoresNearDock / minadores).toBeGreaterThan(0.6);
  });

  it('nivel 1 es azar: no arma formacion, y cada nivel alto usa mas criterio que el anterior en el acorazado', () => {
    const rate = (level: CpuLevel) => {
      let front = 0;
      let n = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const state = layoutFor(level, seed);
        for (const me of PLAYERS) {
          const acorazado = state.pieces.find(p => p.owner === me && p.type === 'Acorazado')!;
          n++;
          if (depthOf(me, acorazado.pos!.r) >= 5) front++;
        }
      }
      return front / n;
    };
    const rates = LEVELS.map(rate);
    expect(rates[0]).toBeLessThan(0.45);
    expect(rates[2]).toBeGreaterThan(rates[0]);
    expect(rates[4]).toBeGreaterThan(rates[2]);
    expect(rates[4]).toBeGreaterThanOrEqual(0.95);
  });

  it('las partidas arrancan bien desde cualquier despliegue de nivel alto contra nivel bajo (ningun estado ilegal)', () => {
    const state = layoutFor(5, 7);
    const play = confirmHandoff(state);
    expect(play.phase).toBe('play');
    expect(getCellKind(play.pieces[0].pos!.r, play.pieces[0].pos!.c)).not.toBe('island');
    const action = chooseAction(play, 'A', 2, { rng: mulberry32(1), iterations: ITER });
    expect(typeof applyCpuAction(play, action)).not.toBe('string');
  });
});
