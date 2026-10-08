import { describe, expect, it } from 'vitest';
import type { GameState, Piece, Player, UnitType } from '../engine/types';
import type { CpuAction, CpuLevel } from '../ai/types';
import { getCellKind, getSetupCells } from '../engine/board';
import { canSeeIdentity, confirmHandoff, createInitialState, endTurn, movePiece, placeMine } from '../engine/gameEngine';
import { pathCost } from '../engine/movement';
import {
  actionKey,
  applyAndAdvance,
  applyCpuAction,
  applyPlacements,
  deriveTurnMemo,
  enumerateActions,
  MAX_MINE_ACTIONS_PER_TURN,
  type TurnMemo,
} from '../ai/actions';
import { evaluate, EVAL_WEIGHTS, goalDistance } from '../ai/evaluate';
import { chooseAction, chooseActionStrict, chooseSetup, chooseSetupStrict } from '../ai';
import { cancelCpu, cpu } from '../ai/cpuClient';
import { handleRequest } from '../ai/worker';
import { mulberry32, seedFrom, shuffled } from '../ai/rng';
import { determinize, FLEET_COUNTS, maskedView, maskHiddenTypes, maskState, typeProbs, UNIT_TYPES } from '../ai/view';
import { assertNonInterference, playGame, randomPlayState, scrambleHidden, setupGame } from './ai.helpers';

const LEVELS: CpuLevel[] = [1, 2, 3, 4, 5];
const ITER = 24;
const opp = (p: Player): Player => (p === 'A' ? 'B' : 'A');

function countTypes(pieces: readonly Piece[], owner: Player): Record<UnitType, number> {
  const out = Object.fromEntries(UNIT_TYPES.map(t => [t, 0])) as Record<UnitType, number>;
  for (const p of pieces) if (p.owner === owner) out[p.type]++;
  return out;
}

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

/** Todo lo que el motor acepta dentro de las categorias que enumeramos (fuerza bruta). */
function bruteForce(state: GameState, me: Player, memo: TurnMemo): Set<string> {
  const keys = new Set<string>();
  const add = (a: CpuAction) => {
    if (typeof applyCpuAction(state, a) !== 'string') keys.add(actionKey(a));
  };
  if (state.phase !== 'play' || state.turn !== me) return keys;
  if (state.selectedNumberToken === null) {
    for (let t = 0; t <= 10; t++) add({ kind: 'selectToken', token: t });
    return keys;
  }
  const occupied = new Set(state.pieces.filter(p => p.pos).map(p => `${p.pos!.r},${p.pos!.c}`));
  const mineAt = new Set(state.mines.map(m => `${m.r},${m.c}`));
  const mine = state.pieces.filter(p => p.owner === me && p.pos);
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const p of mine) {
    for (const [dr, dc] of dirs) {
      const to = { r: p.pos!.r + dr, c: p.pos!.c + dc };
      if (pathCost(p, [to], state.pieces, state.mines) !== null) add({ kind: 'move', pieceId: p.id, to });
      if (p.type === 'Minador' && memo.mineActions < MAX_MINE_ACTIONS_PER_TURN) {
        const k = `${to.r},${to.c}`;
        const inBounds = to.r >= 1 && to.r <= 20 && to.c >= 1 && to.c <= 24;
        if (inBounds && getCellKind(to.r, to.c) === 'sea' && !occupied.has(k) && !mineAt.has(k)) {
          add({ kind: 'placeMine', pieceId: p.id, at: to });
        }
        if (mineAt.has(k)) add({ kind: 'liftMine', pieceId: p.id, at: to });
      }
    }
    for (const q of state.pieces) {
      if (!q.pos) continue;
      add({ kind: 'attack', attackerId: p.id, targetId: q.id });
      add({ kind: 'recon', pieceId: p.id, targetId: q.id });
    }
  }
  add({ kind: 'endTurn' });
  return keys;
}

const keysOf = (acts: CpuAction[]) => new Set(acts.map(actionKey));

function sampleStates(): GameState[] {
  const out: GameState[] = [];
  for (let seed = 1; seed <= 36; seed++) {
    const turns = seed % 9;
    out.push(randomPlayState(seed, { turns, midTurn: seed % 2 === 0 }));
  }
  return out.filter(s => s.phase === 'play');
}

describe('rng', () => {
  it('mulberry32 es determinista y esta en [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('shuffled devuelve una permutacion sin tocar la entrada', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffled(src, mulberry32(7));
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(src);
  });

  it('seedFrom depende de todos sus argumentos', () => {
    expect(seedFrom(1, 'a')).toBe(seedFrom(1, 'a'));
    expect(seedFrom(1, 'a')).not.toBe(seedFrom(2, 'a'));
    expect(seedFrom(1, 'a')).not.toBe(seedFrom(1, 'b'));
  });
});

describe('enumerateActions', () => {
  it('sin ficha elegida ofrece solo selectToken, una por ficha disponible', () => {
    const state = { ...randomPlayState(3, { turns: 2 }), selectedNumberToken: null };
    const acts = enumerateActions(state, state.turn);
    expect(acts.every(a => a.kind === 'selectToken')).toBe(true);
    expect(acts.map(a => (a as { token: number }).token)).toEqual(
      [...new Set(state.numberTokens[state.turn])].sort((x, y) => x - y),
    );
  });

  it('devuelve [] fuera de play o fuera del turno de `me`', () => {
    const state = randomPlayState(5, { turns: 1 });
    expect(enumerateActions(state, opp(state.turn))).toEqual([]);
    expect(enumerateActions({ ...state, phase: 'handoffPlay' }, state.turn)).toEqual([]);
    expect(enumerateActions({ ...state, phase: 'finished' }, state.turn)).toEqual([]);
  });

  it('solo devuelve acciones que el motor acepta, y verify:false da el mismo conjunto', () => {
    const states = sampleStates();
    expect(states.length).toBeGreaterThan(20);
    let total = 0;
    for (const s of states) {
      const verified = enumerateActions(s, s.turn);
      const fast = enumerateActions(s, s.turn, undefined, { verify: false });
      for (const a of verified) expect(typeof applyCpuAction(s, a)).not.toBe('string');
      expect(keysOf(fast)).toEqual(keysOf(verified));
      expect(fast.map(actionKey)).toEqual(verified.map(actionKey));
      expect(new Set(verified.map(actionKey)).size).toBe(verified.length);
      total += verified.length;
    }
    expect(total).toBeGreaterThan(500);
  });

  it('cubre todo lo que el motor acepta dentro de las categorias enumeradas', () => {
    let attacks = 0;
    let recons = 0;
    let mines = 0;
    for (const s of sampleStates()) {
      const memo = deriveTurnMemo(s);
      const expected = bruteForce(s, s.turn, memo);
      const got = enumerateActions(s, s.turn, memo);
      expect(keysOf(got)).toEqual(expected);
      attacks += got.filter(a => a.kind === 'attack').length;
      recons += got.filter(a => a.kind === 'recon').length;
      mines += got.filter(a => a.kind === 'placeMine' || a.kind === 'liftMine').length;
    }
    expect(attacks).toBeGreaterThan(0);
    expect(recons).toBeGreaterThan(0);
    expect(mines).toBeGreaterThan(0);
  });

  it('no ofrece movimientos ilegales (isla, ocupada, fuera, mina) y el motor tambien los rechaza', () => {
    const state = scenario(
      {
        'A-Fragata-0': { r: 5, c: 5 }, // isla en (5,4)
        'A-Fragata-1': { r: 5, c: 6 }, // ocupa la celda de al lado
        'A-Crucero-0': { r: 3, c: 1 }, // borde izquierdo
        'A-Acorazado-0': { r: 9, c: 9 }, // mina en (9,10)
        'A-Minador-0': { r: 12, c: 9 }, // mina en (12,10)
        'B-Acorazado-0': { r: 20, c: 24 },
      },
      { mines: [{ r: 9, c: 10, owner: 'B' }, { r: 12, c: 10, owner: 'B' }] },
    );
    // El motor rechaza isla, casilla ocupada y fuera del tablero (las piezas nunca se encimen).
    expect(typeof movePiece(state, 'A-Fragata-0', { r: 5, c: 4 })).toBe('string');
    expect(typeof movePiece(state, 'A-Fragata-0', { r: 5, c: 6 })).toBe('string');
    expect(typeof movePiece(state, 'A-Crucero-0', { r: 3, c: 0 })).toBe('string');

    const moves = enumerateActions(state, 'A').filter(a => a.kind === 'move');
    const has = (id: string, r: number, c: number) =>
      moves.some(a => a.kind === 'move' && a.pieceId === id && a.to.r === r && a.to.c === c);
    expect(has('A-Fragata-0', 5, 4)).toBe(false);
    expect(has('A-Fragata-0', 5, 6)).toBe(false);
    expect(has('A-Fragata-0', 4, 5)).toBe(true);
    expect(has('A-Crucero-0', 3, 0)).toBe(false);
    expect(has('A-Crucero-0', 3, 2)).toBe(true);
    expect(has('A-Acorazado-0', 9, 10)).toBe(false);
    expect(has('A-Minador-0', 12, 10)).toBe(true);
  });

  it('una pieza averiada (costo 2) no se mueve con 1 de presupuesto', () => {
    const state = scenario(
      { 'A-Crucero-0': { r: 8, c: 8 }, 'A-Fragata-0': { r: 10, c: 8 }, 'B-Acorazado-0': { r: 20, c: 1 } },
      { selectedNumberToken: 2, movementBudgetSpent: 1 },
      { 'A-Crucero-0': { damaged: true } },
    );
    const moves = enumerateActions(state, 'A').filter(a => a.kind === 'move');
    expect(moves.some(a => a.kind === 'move' && a.pieceId === 'A-Crucero-0')).toBe(false);
    expect(moves.some(a => a.kind === 'move' && a.pieceId === 'A-Fragata-0')).toBe(true);
  });

  it('respeta alcance, linea de vista y el orden "el avion de combate ataca antes de moverse"', () => {
    const state = scenario({
      'A-Fragata-0': { r: 10, c: 5 }, // alcance 2
      'A-AvionCombate-0': { r: 12, c: 12 },
      'A-AvionReconocimiento-0': { r: 11, c: 20 },
      'A-Minador-0': { r: 6, c: 12 }, // tapa la linea del avion hacia B-Minador-0
      'B-Crucero-0': { r: 10, c: 7 }, // a 2: en rango
      'B-Fragata-0': { r: 10, c: 9 }, // tapado por B-Crucero-0 / fuera de rango
      'B-Submarino-0': { r: 12, c: 3 },
      'B-Minador-0': { r: 4, c: 12 },
      'B-Acorazado-0': { r: 11, c: 3 },
    });
    const acts = enumerateActions(state, 'A');
    const attacks = acts.filter(a => a.kind === 'attack').map(actionKey);
    expect(attacks).toContain('aA-Fragata-0>B-Crucero-0');
    expect(attacks).not.toContain('aA-Fragata-0>B-Fragata-0');
    expect(attacks).toContain('aA-AvionCombate-0>B-Submarino-0');
    expect(attacks).not.toContain('aA-AvionCombate-0>B-Minador-0');
    expect(acts.some(a => a.kind === 'attack' && a.attackerId === 'A-AvionReconocimiento-0')).toBe(false);
    const recons = acts.filter(a => a.kind === 'recon').map(actionKey);
    expect(recons).toContain('rA-AvionReconocimiento-0>B-Acorazado-0');
    expect(recons.every(k => k.startsWith('rA-AvionReconocimiento-0>'))).toBe(true);

    const moved = movePiece(state, 'A-Fragata-0', { r: 11, c: 5 });
    if (typeof moved === 'string') throw new Error(moved);
    const after = enumerateActions(moved, 'A');
    expect(after.some(a => a.kind === 'attack' && a.attackerId === 'A-AvionCombate-0')).toBe(false);
    expect(after.some(a => a.kind === 'attack' && a.attackerId === 'A-Fragata-0')).toBe(true);
  });

  it('las minas: solo mar, adyacentes al Minador, sin ocupar, y a lo sumo una accion de mina por turno', () => {
    const state = scenario({
      'A-Minador-0': { r: 9, c: 13 },
      'A-Fragata-0': { r: 9, c: 14 },
      'B-Acorazado-0': { r: 20, c: 1 },
    });
    const mineActs = enumerateActions(state, 'A').filter(a => a.kind === 'placeMine' || a.kind === 'liftMine');
    expect(mineActs.map(actionKey).sort()).toEqual(
      ['pA-Minador-0@8,13', 'pA-Minador-0@10,13', 'pA-Minador-0@9,12'].sort(),
    );

    const withMine = placeMine(state, 'A-Minador-0', { r: 8, c: 13 });
    if (typeof withMine === 'string') throw new Error(withMine);
    expect(deriveTurnMemo(withMine).mineActions).toBe(1);
    expect(enumerateActions(withMine, 'A').some(a => a.kind === 'placeMine' || a.kind === 'liftMine')).toBe(false);
    expect(enumerateActions(withMine, 'A', { mineActions: 0 }).some(a => a.kind === 'liftMine')).toBe(true);

    const nearBay = scenario({ 'A-Minador-0': { r: 3, c: 12 }, 'B-Acorazado-0': { r: 20, c: 1 } });
    const cells = enumerateActions(nearBay, 'A')
      .filter(a => a.kind === 'placeMine')
      .map(a => (a.kind === 'placeMine' ? `${a.at.r},${a.at.c}` : ''));
    expect(getCellKind(2, 12)).toBe('bay');
    expect(cells).not.toContain('2,12');
    expect(cells).toContain('4,12');
  });

  it('un turno siempre termina en endTurn en <= 25 acciones aunque el jugador evite endTurn', () => {
    const rng = mulberry32(99);
    let worst = 0;
    for (const s0 of sampleStates()) {
      let s: GameState = { ...s0, selectedNumberToken: null, movementBudgetSpent: 0, attackOrReconUsedThisTurn: false, combatPlaneAttackUsedThisTurn: false, log: [] };
      let n = 0;
      for (;;) {
        const acts = enumerateActions(s, s.turn);
        const nonEnd = acts.filter(a => a.kind !== 'endTurn');
        const a = nonEnd.length > 0 ? nonEnd[Math.floor(rng() * nonEnd.length)] : acts[acts.length - 1];
        const next = applyCpuAction(s, a);
        if (typeof next === 'string') throw new Error(next);
        n++;
        s = next;
        if (a.kind === 'endTurn' || s.phase === 'finished') break;
        expect(n).toBeLessThanOrEqual(25);
      }
      worst = Math.max(worst, n);
    }
    expect(worst).toBeLessThanOrEqual(25);
  });
});

describe('memoria de turno y applyAndAdvance', () => {
  it('deriveTurnMemo cuenta las minas del turno en curso con el log real del motor', () => {
    let s = scenario({ 'A-Minador-0': { r: 9, c: 13 }, 'B-Minador-0': { r: 12, c: 13 } }, { log: ['Setup completado. ¡Comienza el juego!'] });
    expect(deriveTurnMemo(s).mineActions).toBe(0);
    const placed = placeMine(s, 'A-Minador-0', { r: 9, c: 12 });
    if (typeof placed === 'string') throw new Error(placed);
    s = placed;
    expect(deriveTurnMemo(s).mineActions).toBe(1);

    const ended = endTurn(s);
    if (typeof ended === 'string') throw new Error(ended);
    const next = confirmHandoff(ended);
    expect(deriveTurnMemo(next).mineActions).toBe(0);
    const sel = { ...next, selectedNumberToken: 3 };
    const placedB = placeMine(sel, 'B-Minador-0', { r: 12, c: 12 });
    if (typeof placedB === 'string') throw new Error(placedB);
    expect(deriveTurnMemo(placedB).mineActions).toBe(1);
  });

  it('applyAndAdvance confirma el handoff tras endTurn y mantiene el log acotado', () => {
    const s0 = randomPlayState(11, { turns: 3 });
    expect(s0.log.length).toBeGreaterThan(0);
    let s: GameState = s0;
    const me = s.turn;
    for (let guard = 0; guard < 30; guard++) {
      const acts = enumerateActions(s, s.turn);
      const a = s.selectedNumberToken === null ? acts[acts.length - 1] : { kind: 'endTurn' as const };
      const next = applyAndAdvance(s, a);
      if (typeof next === 'string') throw new Error(next);
      s = next;
      if (a.kind === 'endTurn') break;
    }
    expect(s.turn).toBe(opp(me));
    expect(s.phase).toBe('play');
    expect(s.selectedNumberToken).toBeNull();
    expect(s.log).toEqual([]);
  });

  it('applyAndAdvance conserva la memoria de minas dentro del turno', () => {
    const base = scenario({ 'A-Minador-0': { r: 9, c: 13 }, 'B-Acorazado-0': { r: 20, c: 1 } });
    const after = applyAndAdvance(base, { kind: 'placeMine', pieceId: 'A-Minador-0', at: { r: 9, c: 12 } });
    if (typeof after === 'string') throw new Error(after);
    expect(deriveTurnMemo(after).mineActions).toBe(1);
    expect(enumerateActions(after, 'A').some(a => a.kind === 'placeMine' || a.kind === 'liftMine')).toBe(false);
    const mv = applyAndAdvance(after, { kind: 'move', pieceId: 'A-Minador-0', to: { r: 10, c: 13 } });
    if (typeof mv === 'string') throw new Error(mv);
    expect(deriveTurnMemo(mv).mineActions).toBe(1);
  });
});

describe('maskedView y determinize', () => {
  const states = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(seed => randomPlayState(seed, { turns: seed % 7, midTurn: seed % 2 === 0 }));

  it('la vista oculta exactamente lo que canSeeIdentity oculta y el pool tiene la composicion restante', () => {
    let sawHidden = false;
    let sawRevealed = false;
    for (const s of states) {
      for (const me of ['A', 'B'] as const) {
        const { view: v, ids } = maskState(s, me);
        for (const p of s.pieces) {
          const vp = v.pieces.find(x => x.id === ids.toView(p.id))!;
          expect(vp.type).toBe(canSeeIdentity(p, me) ? p.type : null);
          expect(vp.pos).toBe(p.pos);
          expect(vp.owner).toBe(p.owner);
          if (p.owner === me) expect(vp.type).toBe(p.type);
        }
        const enemy = s.pieces.filter(p => p.owner === opp(me));
        const hiddenReal = enemy.filter(p => !canSeeIdentity(p, me));
        expect(new Set(v.hiddenIds)).toEqual(new Set(hiddenReal.map(p => ids.toView(p.id))));
        expect(v.unknownPool.length).toBe(v.hiddenIds.length);
        const poolCounts = Object.fromEntries(UNIT_TYPES.map(t => [t, 0])) as Record<UnitType, number>;
        for (const t of v.unknownPool) poolCounts[t]++;
        expect(poolCounts).toEqual(countTypes(hiddenReal, opp(me)));
        if (v.hiddenIds.length > 0) sawHidden = true;
        if (enemy.some(p => canSeeIdentity(p, me))) sawRevealed = true;
        expect('log' in v).toBe(false);
      }
    }
    expect(sawHidden).toBe(true);
    expect(sawRevealed).toBe(true);
  });

  it('los ids y el orden de las piezas ocultas no filtran el tipo (ni en la vista ni en las acciones)', () => {
    for (const s of states) {
      if (s.phase !== 'play') continue;
      const me = s.turn;
      const { view, ids } = maskState(s, me);
      const mentionsType = (id: string) => UNIT_TYPES.some(t => id.includes(t));
      for (const p of view.pieces) {
        if (p.type === null) {
          expect(p.id.startsWith('?')).toBe(true);
          expect(mentionsType(p.id)).toBe(false);
        } else {
          expect(p.id.startsWith('?')).toBe(false);
        }
      }
      const firstHidden = view.pieces.findIndex(p => p.type === null);
      if (firstHidden >= 0) {
        const tail = view.pieces.slice(firstHidden);
        expect(tail.every(p => p.type === null)).toBe(true);
        const alive = tail.filter(p => p.pos);
        const sorted = [...alive].sort((a, b) => a.pos!.r - b.pos!.r || a.pos!.c - b.pos!.c);
        expect(alive.map(p => p.id)).toEqual(sorted.map(p => p.id));
      }
      const legal = enumerateActions(s, me).map(ids.viewAction);
      for (const a of legal) {
        const used = a.kind === 'attack' ? [a.attackerId, a.targetId] : a.kind === 'recon' ? [a.pieceId, a.targetId] : 'pieceId' in a ? [a.pieceId] : [];
        for (const id of used) {
          const vp = view.pieces.find(p => p.id === id);
          expect(vp).toBeDefined();
          if (vp!.type === null) expect(mentionsType(id)).toBe(false);
        }
        expect(ids.viewAction(ids.realAction(a))).toEqual(a);
      }
    }
  });

  it('determinize conserva la composicion, no toca lo visible y deja ocultos ilesos', () => {
    for (const s of states) {
      for (const me of ['A', 'B'] as const) {
        const { view: v, ids } = maskState(s, me);
        const w = determinize(v, mulberry32(s.log.length + 1));
        expect(countTypes(w.pieces, 'A')).toEqual(FLEET_COUNTS);
        expect(countTypes(w.pieces, 'B')).toEqual(FLEET_COUNTS);
        expect(new Set(w.pieces.map(p => p.id)).size).toBe(32);
        for (const p of w.pieces) {
          const real = s.pieces.find(x => x.id === ids.toReal(p.id))!;
          expect(p.pos).toEqual(real.pos);
          expect(p.damaged).toBe(real.damaged);
          expect(p.owner).toBe(real.owner);
          if (canSeeIdentity(real, me)) {
            expect(p.type).toBe(real.type);
            expect(p.revealedTo).toEqual(real.revealedTo);
          } else {
            expect(p.damaged).toBe(false);
          }
        }
        expect(w.mines).toEqual(s.mines);
        expect(w.numberTokens).toEqual(s.numberTokens);
        expect(w.turn).toBe(s.turn);
        expect(w.phase).toBe(s.phase);
        expect(w.selectedNumberToken).toBe(s.selectedNumberToken);
        expect(w.movementBudgetSpent).toBe(s.movementBudgetSpent);
        expect(w.winner).toBe(s.winner);
        expect(w.log.length).toBe(v.memo.mineActions);
        expect(maskedView(w, me)).toEqual(v);
      }
    }
  });

  it('determinize es determinista por semilla y muestrea distintos mundos', () => {
    const s = states.find(x => maskedView(x, x.turn).hiddenIds.length >= 6)!;
    const v = maskedView(s, s.turn);
    expect(determinize(v, mulberry32(5))).toEqual(determinize(v, mulberry32(5)));
    const worlds = new Set<string>();
    for (let k = 0; k < 20; k++) {
      worlds.add(determinize(v, mulberry32(k)).pieces.map(p => p.type).join());
    }
    expect(worlds.size).toBeGreaterThan(10);
  });

  it('determinize respeta las restricciones `allowed` cuando es posible', () => {
    const s = states.find(x => maskedView(x, x.turn).hiddenIds.length >= 6)!;
    const v = maskedView(s, s.turn);
    const [a, b] = v.hiddenIds;
    const allowed = { [a]: ['Acorazado', 'Crucero'] as UnitType[], [b]: ['Submarino'] as UnitType[] };
    const feasible = v.unknownPool.includes('Submarino') && (v.unknownPool.includes('Acorazado') || v.unknownPool.includes('Crucero'));
    expect(feasible).toBe(true);
    for (let k = 0; k < 15; k++) {
      const w = determinize(v, mulberry32(k), { allowed });
      expect(['Acorazado', 'Crucero']).toContain(w.pieces.find(p => p.id === a)!.type);
      expect(w.pieces.find(p => p.id === b)!.type).toBe('Submarino');
      expect(countTypes(w.pieces, opp(s.turn))).toEqual(FLEET_COUNTS);
    }
  });

  it('typeProbs: delta para lo visible, uniforme sobre el pool para lo oculto', () => {
    const s = states.find(x => maskedView(x, x.turn).hiddenIds.length >= 6)!;
    const v = maskedView(s, s.turn);
    const own = v.pieces.find(p => p.owner === v.me)!;
    expect(typeProbs(v, own.id)).toEqual([[own.type, 1]]);
    const probs = typeProbs(v, v.hiddenIds[0]);
    expect(probs.reduce((acc, [, p]) => acc + p, 0)).toBeCloseTo(1, 10);
  });

  it('maskHiddenTypes borra el tipo oculto y deja intacto lo visible', () => {
    const s = states.find(x => maskedView(x, x.turn).hiddenIds.length >= 6)!;
    const me = s.turn;
    const m = maskHiddenTypes(s, me);
    for (const p of m.pieces) {
      const real = s.pieces.find(x => x.id === p.id)!;
      if (canSeeIdentity(real, me)) expect(p.type).toBe(real.type);
      else expect(p.type).toBe('Fragata');
    }
  });
});

describe('no-interferencia (la accion no depende de tipos enemigos ocultos)', () => {
  for (const level of LEVELS) {
    it(`nivel ${level}`, () => {
      const report = assertNonInterference(level, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], { iterations: ITER, scrambles: 2 });
      expect(report.checked).toBeGreaterThan(8);
      expect(report.withHidden).toBeGreaterThan(5);
    });
  }
});

describe('chooseAction / chooseSetup', () => {
  it('siempre devuelve acciones que el motor acepta y cierra el turno en <= 25 acciones', () => {
    for (const level of LEVELS) {
      for (const seed of [21, 22, 23, 24]) {
        let s: GameState = { ...randomPlayState(seed, { turns: seed % 5 }), selectedNumberToken: null, movementBudgetSpent: 0, attackOrReconUsedThisTurn: false, combatPlaneAttackUsedThisTurn: false };
        const me = s.turn;
        let n = 0;
        for (;;) {
          const a = chooseActionStrict(s, me, level, { rng: mulberry32(seed + n), iterations: ITER });
          expect(actionKey(a)).toBe(actionKey(chooseAction(s, me, level, { rng: mulberry32(seed + n), iterations: ITER })));
          const next = applyCpuAction(s, a);
          expect(typeof next).not.toBe('string');
          s = next as GameState;
          n++;
          if (a.kind === 'endTurn' || s.phase === 'finished') break;
          expect(n).toBeLessThanOrEqual(25);
        }
        expect(s.phase === 'handoffPlay' || s.phase === 'finished').toBe(true);
      }
    }
  });

  it('trata handoffPlay como play y devuelve endTurn fuera del turno, sin lanzar', () => {
    const s = randomPlayState(8, { turns: 2 });
    const handoff: GameState = { ...s, phase: 'handoffPlay' };
    const a = chooseAction(handoff, s.turn, 1, { rng: mulberry32(1) });
    expect(typeof applyCpuAction(confirmHandoff(handoff), a)).not.toBe('string');
    expect(chooseAction(s, opp(s.turn), 3)).toEqual({ kind: 'endTurn' });
    expect(chooseAction({ ...s, phase: 'finished' }, s.turn, 5)).toEqual({ kind: 'endTurn' });
  });

  it('con una unica accion legal la devuelve sin buscar', () => {
    const s = scenario({ 'A-Acorazado-0': { r: 8, c: 8 } }, { selectedNumberToken: 4, movementBudgetSpent: 4, mines: [] });
    expect(enumerateActions(s, 'A')).toEqual([{ kind: 'endTurn' }]);
    for (const level of LEVELS) expect(chooseAction(s, 'A', level)).toEqual({ kind: 'endTurn' });
  });

  it('chooseSetup reparte las 16 piezas, una por celda, dentro de la franja, para A y B', () => {
    for (const level of LEVELS) {
      let state = createInitialState();
      for (const me of ['A', 'B'] as const) {
        const placements = chooseSetup(state, me, level, { rng: mulberry32(level * 10), iterations: ITER });
        expect(placements).toHaveLength(16);
        expect(new Set(placements.map(p => p.pieceId)).size).toBe(16);
        expect(new Set(placements.map(p => `${p.pos.r},${p.pos.c}`)).size).toBe(16);
        const zone = new Set(getSetupCells(me).map(c => `${c.r},${c.c}`));
        for (const p of placements) {
          expect(zone.has(`${p.pos.r},${p.pos.c}`)).toBe(true);
          expect(state.pieces.find(x => x.id === p.pieceId)!.owner).toBe(me);
        }
        expect(chooseSetupStrict(state, me, level, { rng: mulberry32(level * 10), iterations: ITER })).toEqual(placements);
        const placed = applyPlacements(state, placements);
        expect(typeof placed).not.toBe('string');
        state = { ...(placed as GameState), phase: 'setupB', setupPlayer: 'B', setupPlacedPieceIds: [] };
      }
    }
  });

  it('chooseSetup sin rng es determinista por estado', () => {
    const state = createInitialState();
    expect(chooseSetup(state, 'A', 1)).toEqual(chooseSetup(state, 'A', 1));
  });
});

describe('evaluate', () => {
  const states = [1, 2, 3, 4, 5, 6].map(seed => randomPlayState(seed, { turns: seed * 2, midTurn: seed % 2 === 0 }));

  it('esta acotada, es antisimetrica y los estados terminales valen +-1', () => {
    for (const s of states) {
      for (const me of ['A', 'B'] as const) {
        const v = evaluate(s, me);
        if (s.phase !== 'finished') {
          expect(Math.abs(v)).toBeLessThan(1);
          expect(Math.abs(v)).toBeLessThanOrEqual(EVAL_WEIGHTS.max);
        }
        expect(v).toBeCloseTo(-evaluate(s, opp(me)), 12);
      }
    }
    const won: GameState = { ...states[0], phase: 'finished', winner: 'A' };
    expect(evaluate(won, 'A')).toBe(1);
    expect(evaluate(won, 'B')).toBe(-1);
    expect(evaluate({ ...won, winner: null }, 'A')).toBe(0);
  });

  it('el estado inicial simetrico vale cerca de 0 y perder una pieza baja el valor', () => {
    const s = setupGame(1, 1, 5);
    const sym = Math.abs(evaluate(s, 'A'));
    expect(sym).toBeLessThan(0.6);
    const lost = { ...s, pieces: s.pieces.map(p => (p.id === 'A-Acorazado-0' ? { ...p, pos: null } : p)) };
    expect(evaluate(lost, 'A')).toBeLessThan(evaluate(s, 'A'));
    expect(evaluate(lost, 'B')).toBeGreaterThan(evaluate(s, 'B'));
    const damaged = { ...s, pieces: s.pieces.map(p => (p.id === 'A-Crucero-0' ? { ...p, damaged: true } : p)) };
    expect(evaluate(damaged, 'A')).toBeLessThan(evaluate(s, 'A'));
  });

  it('avanzar hacia la zona de llegada rival y amenazar a un barco suben el valor', () => {
    const far = scenario({ 'A-Fragata-0': { r: 8, c: 12 }, 'B-Fragata-0': { r: 20, c: 2 } }, { selectedNumberToken: null });
    const near = scenario({ 'A-Fragata-0': { r: 14, c: 12 }, 'B-Fragata-0': { r: 20, c: 2 } }, { selectedNumberToken: null });
    expect(evaluate(near, 'A')).toBeGreaterThan(evaluate(far, 'A'));
    expect(goalDistance('A', 14, 12)).toBeLessThan(goalDistance('A', 8, 12));
    expect(goalDistance('A', 19, 10)).toBe(0);
    expect(goalDistance('B', 2, 10)).toBe(0);

    const safe = scenario({ 'A-Acorazado-0': { r: 10, c: 6 }, 'B-Crucero-0': { r: 11, c: 9 } }, { selectedNumberToken: null });
    const threat = scenario({ 'A-Acorazado-0': { r: 10, c: 6 }, 'B-Crucero-0': { r: 10, c: 9 } }, { selectedNumberToken: null });
    expect(evaluate(threat, 'A')).toBeGreaterThan(evaluate(safe, 'A'));
  });

  it('es rapida (< 400 microsegundos por llamada de media, con margen para maquinas ocupadas)', () => {
    const s = states[3];
    evaluate(s, 'A');
    const t0 = performance.now();
    const N = 4000;
    let acc = 0;
    for (let i = 0; i < N; i++) acc += evaluate(s, i % 2 ? 'A' : 'B');
    const per = ((performance.now() - t0) * 1000) / N;
    expect(Number.isFinite(acc)).toBe(true);
    expect(per).toBeLessThan(400);
  });
});

describe('partidas CPU contra CPU', () => {
  it('stub contra stub termina o llega al tope sin lanzar', () => {
    for (const [la, lb, seed] of [
      [1, 1, 1],
      [2, 1, 2],
      [3, 2, 3],
      [5, 4, 4],
    ] as const) {
      const res = playGame(la, lb, seed, { maxTurns: 120, iterations: ITER });
      expect(res.turns).toBeGreaterThan(0);
      expect(res.turns).toBeLessThanOrEqual(120);
      expect(res.actions).toBeGreaterThan(res.turns);
      if (res.state.phase === 'finished') expect(res.winner).not.toBeNull();
      else expect(res.winner).toBeNull();
    }
  });

  it('es reproducible por semilla', () => {
    const a = playGame(2, 3, 7, { maxTurns: 60, iterations: ITER });
    const b = playGame(2, 3, 7, { maxTurns: 60, iterations: ITER });
    expect(b.state).toEqual(a.state);
    expect(b.actions).toBe(a.actions);
  });

  it('scrambleHidden conserva la flota y no cambia la vista', () => {
    const s = randomPlayState(9, { turns: 4 });
    const me = s.turn;
    const sc = scrambleHidden(s, me, mulberry32(3));
    expect(countTypes(sc.pieces, opp(me))).toEqual(countTypes(s.pieces, opp(me)));
    expect(maskedView(sc, me)).toEqual(maskedView(s, me));
    expect(sc.pieces.map(p => p.pos)).toEqual(s.pieces.map(p => p.pos));
  });
});

describe('worker y cliente', () => {
  it('handleRequest responde acciones y despliegues, y reporta errores sin lanzar', () => {
    const s = randomPlayState(4, { turns: 2 });
    const act = handleRequest({ id: 1, kind: 'action', state: s, me: s.turn, level: 2, seed: 9 });
    expect(act.id).toBe(1);
    expect(act.error).toBeUndefined();
    expect(typeof applyCpuAction(s, act.result as CpuAction)).not.toBe('string');

    const setup = handleRequest({ id: 2, kind: 'setup', state: createInitialState(), me: 'A', level: 3, seed: 9 });
    expect(setup.error).toBeUndefined();
    expect(setup.result).toHaveLength(16);

    const bad = handleRequest({ id: 3, kind: 'setup', state: null as unknown as GameState, me: 'A', level: 1 });
    expect(bad.id).toBe(3);
    expect(typeof bad.error).toBe('string');
  });

  it('cpu (sin Worker) resuelve en el hilo principal y cancelCpu rechaza lo pendiente', async () => {
    const s = randomPlayState(4, { turns: 2 });
    const a = await cpu.requestAction(s, s.turn, 2);
    expect(typeof applyCpuAction(s, a)).not.toBe('string');

    const placements = await cpu.requestSetup(createInitialState(), 'A', 1);
    expect(placements).toHaveLength(16);

    const pending = cpu.requestAction(s, s.turn, 1);
    cancelCpu();
    await expect(pending).rejects.toThrow('cancelado');
    await expect(cpu.requestAction(s, s.turn, 1)).resolves.toBeDefined();
  });
});
