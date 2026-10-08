import { describe, it, expect } from 'vitest';
import { resolveCombat } from '../engine/combat';
import { hasLineOfSight, getTargetableCells } from '../engine/lineOfSight';
import { getReachableCells, pathCost, applyMove } from '../engine/movement';
import { getNominalRange, getActualRange, createFleet } from '../engine/pieces';
import { enforceOlvidos, transferToken } from '../engine/tokens';
import { generateRandomIslands } from '../engine/board';
import {
  createInitialState,
  placePieceInSetup,
  finishSetup,
  selectNumberToken,
  movePiece,
  attackPiece,
  reconPiece,
  placeMine,
  liftMine,
  endTurn,
  confirmHandoff,
} from '../engine/gameEngine';
import type { Piece, GameState } from '../engine/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePiece(overrides: Partial<Piece>): Piece {
  return {
    id: 'test',
    owner: 'A',
    type: 'Acorazado',
    pos: { r: 5, c: 5 },
    damaged: false,
    revealedTo: [],
    ...overrides,
  };
}

// Build a minimal playable state, bypassing setup phase entirely
function makePlayState(): GameState {
  const base = createInitialState();
  // Assign positions directly: A in rows 3-4, B in rows 17-18, all cols 1-8
  const pieces = base.pieces.map((p, i) => {
    const idx = base.pieces.filter((x, j) => x.owner === p.owner && j < i).length;
    const r = p.owner === 'A' ? (3 + Math.floor(idx / 8)) : (17 + Math.floor(idx / 8));
    const c = (idx % 8) + 1;
    return { ...p, pos: { r, c } };
  });
  return {
    ...base,
    pieces,
    phase: 'play',
    numberTokens: { A: [2, 3, 4, 5, 6], B: [2, 3, 4, 5, 6] },
  };
}

// ─── 1. Line of sight ────────────────────────────────────────────────────────

describe('Line of sight', () => {
  it('detects clear orthogonal LOS', () => {
    const pieces: Piece[] = [];
    expect(hasLineOfSight({ r: 5, c: 5 }, { r: 5, c: 10 }, pieces)).toBe(true);
    expect(hasLineOfSight({ r: 5, c: 5 }, { r: 10, c: 5 }, pieces)).toBe(true);
  });

  it('rejects diagonal LOS', () => {
    expect(hasLineOfSight({ r: 5, c: 5 }, { r: 6, c: 6 }, [])).toBe(false);
  });

  it('is blocked by an island (col 3, row 5)', () => {
    // Island at r=5,c=3 (from boardConfig)
    expect(hasLineOfSight({ r: 5, c: 1 }, { r: 5, c: 5 }, [])).toBe(false);
  });

  it('is blocked by an intermediate piece', () => {
    const blocker = makePiece({ id: 'b', pos: { r: 5, c: 7 } });
    expect(hasLineOfSight({ r: 5, c: 5 }, { r: 5, c: 10 }, [blocker])).toBe(false);
  });

  it('is NOT blocked by mines (mines don\'t block LOS)', () => {
    const mine = { r: 9, c: 5, owner: 'A' as const };
    const cells = getTargetableCells(8, 5, Infinity, [], [mine]);
    const targets = cells.map(c => `${c.r},${c.c}`);
    expect(targets).toContain('10,5'); // can shoot through mine row
  });
});

// ─── 2. Ranges ───────────────────────────────────────────────────────────────

describe('Ranges', () => {
  it('nominal ranges are correct', () => {
    expect(getNominalRange('Acorazado')).toBe(6);
    expect(getNominalRange('Crucero')).toBe(4);
    expect(getNominalRange('Fragata')).toBe(2);
    expect(getNominalRange('Minador')).toBe(1);
    expect(getNominalRange('Submarino')).toBe(1);
    expect(getNominalRange('AvionCombate')).toBe(Infinity);
    expect(getNominalRange('AvionReconocimiento')).toBe(Infinity);
  });

  it('damaged range = floor(nominal/2)', () => {
    const damagedA = makePiece({ type: 'Acorazado', damaged: true });
    const damagedC = makePiece({ type: 'Crucero', damaged: true });
    const damagedF = makePiece({ type: 'Fragata', damaged: true });
    expect(getActualRange(damagedA)).toBe(3);
    expect(getActualRange(damagedC)).toBe(2);
    expect(getActualRange(damagedF)).toBe(1);
  });
});

// ─── 3. Combat table (all 14 cases) ─────────────────────────────────────────

describe('Combat table', () => {
  // a) Barco attacks
  it('a.1 Barco attacks barco of GREATER range → AVERIADO', () => {
    const f = makePiece({ type: 'Fragata' });        // range 2
    const a = makePiece({ type: 'Acorazado', owner: 'B' }); // range 6
    expect(resolveCombat(f, a, 1, false)).toBe('AVERIADO');
  });

  it('a.2 Barco attacks barco of EQUAL range → HUNDIDO', () => {
    const c1 = makePiece({ type: 'Crucero' });
    const c2 = makePiece({ type: 'Crucero', owner: 'B' });
    expect(resolveCombat(c1, c2, 2, false)).toBe('HUNDIDO');
  });

  it('a.2 Barco attacks barco of LESSER range → HUNDIDO', () => {
    const a = makePiece({ type: 'Acorazado' });
    const f = makePiece({ type: 'Fragata', owner: 'B' });
    expect(resolveCombat(a, f, 1, false)).toBe('HUNDIDO');
  });

  it('a.3 Barco attacks AVERIADO barco → HUNDIDO', () => {
    const f = makePiece({ type: 'Fragata' });
    const a = makePiece({ type: 'Acorazado', owner: 'B', damaged: true });
    expect(resolveCombat(f, a, 1, false)).toBe('HUNDIDO');
  });

  it('a.4 Acorazado/Crucero/Minador attacks Submarino → ILESO', () => {
    const sub = makePiece({ type: 'Submarino', owner: 'B' });
    expect(resolveCombat(makePiece({ type: 'Acorazado' }), sub, 1, false)).toBe('ILESO');
    expect(resolveCombat(makePiece({ type: 'Crucero' }), sub, 1, false)).toBe('ILESO');
    expect(resolveCombat(makePiece({ type: 'Minador' }), sub, 1, false)).toBe('ILESO');
  });

  it('a.5 Fragata attacks Submarino → HUNDIDO', () => {
    const f = makePiece({ type: 'Fragata' });
    const s = makePiece({ type: 'Submarino', owner: 'B' });
    expect(resolveCombat(f, s, 1, false)).toBe('HUNDIDO');
  });

  it('a.6 Barco attacks Avion from dist 1 → DERRIBADO', () => {
    const a = makePiece({ type: 'Acorazado' });
    const ac = makePiece({ type: 'AvionCombate', owner: 'B' });
    expect(resolveCombat(a, ac, 1, false)).toBe('DERRIBADO');
  });

  it('a.7 Barco attacks Avion from dist >= 2 → ILESO', () => {
    const a = makePiece({ type: 'Acorazado' });
    const ac = makePiece({ type: 'AvionCombate', owner: 'B' });
    expect(resolveCombat(a, ac, 2, false)).toBe('ILESO');
    expect(resolveCombat(a, ac, 5, false)).toBe('ILESO');
  });

  // b) Submarino attacks
  it('b.1 Sub attacks Acorazado/Crucero/Minador → HUNDIDO', () => {
    const s = makePiece({ type: 'Submarino' });
    expect(resolveCombat(s, makePiece({ type: 'Acorazado', owner: 'B' }), 1, false)).toBe('HUNDIDO');
    expect(resolveCombat(s, makePiece({ type: 'Crucero', owner: 'B' }), 1, false)).toBe('HUNDIDO');
    expect(resolveCombat(s, makePiece({ type: 'Minador', owner: 'B' }), 1, false)).toBe('HUNDIDO');
  });

  it('b.2 Sub attacks Fragata → ILESA', () => {
    const s = makePiece({ type: 'Submarino' });
    const f = makePiece({ type: 'Fragata', owner: 'B' });
    expect(resolveCombat(s, f, 1, false)).toBe('ILESA');
  });

  it('b.3 Sub attacks Sub → ILESO', () => {
    const s1 = makePiece({ type: 'Submarino' });
    const s2 = makePiece({ type: 'Submarino', owner: 'B' });
    expect(resolveCombat(s1, s2, 1, false)).toBe('ILESO');
  });

  it('b.4 Sub attacks Avion → DERRIBADO', () => {
    const s = makePiece({ type: 'Submarino' });
    const ac = makePiece({ type: 'AvionCombate', owner: 'B' });
    expect(resolveCombat(s, ac, 1, false)).toBe('DERRIBADO');
  });

  // c) Avion attacks
  it('c.1 Avion attacks Barco → ILESO', () => {
    const ac = makePiece({ type: 'AvionCombate' });
    expect(resolveCombat(ac, makePiece({ type: 'Acorazado', owner: 'B' }), 5, false)).toBe('ILESO');
  });

  it('c.2 Avion attacks Submarino → HUNDIDO', () => {
    const ac = makePiece({ type: 'AvionCombate' });
    const s = makePiece({ type: 'Submarino', owner: 'B' });
    expect(resolveCombat(ac, s, 5, false)).toBe('HUNDIDO');
  });

  it('c.3 Avion attacks Avion → DERRIBADO', () => {
    const ac1 = makePiece({ type: 'AvionCombate' });
    const ac2 = makePiece({ type: 'AvionCombate', owner: 'B' });
    expect(resolveCombat(ac1, ac2, 5, false)).toBe('DERRIBADO');
  });
});

// ─── 4. Movement budget ──────────────────────────────────────────────────────

describe('Movement budget', () => {
  it('undamaged piece costs 1 per cell', () => {
    const piece = makePiece({ type: 'Crucero', pos: { r: 10, c: 10 } });
    const cells = getReachableCells(piece, 3, [piece], []);
    // All cells within 3 orthogonal steps
    expect(cells.length).toBeGreaterThan(0);
    // Cell 3 steps away should be included
    expect(cells.some(c => c.r === 10 && c.c === 13)).toBe(true);
    // Cell 4 steps away should NOT be included
    expect(cells.some(c => c.r === 10 && c.c === 14)).toBe(false);
  });

  it('damaged piece costs 2 per cell', () => {
    const piece = makePiece({ type: 'Acorazado', damaged: true, pos: { r: 10, c: 10 } });
    const cells = getReachableCells(piece, 4, [piece], []);
    // With budget 4, can reach 2 cells orthogonally
    expect(cells.some(c => c.r === 10 && c.c === 12)).toBe(true);
    expect(cells.some(c => c.r === 10 && c.c === 13)).toBe(false);
  });

  it('no diagonal movement', () => {
    const piece = makePiece({ pos: { r: 10, c: 10 } });
    const cells = getReachableCells(piece, 1, [piece], []);
    expect(cells.every(c => c.r === 10 || c.c === 10)).toBe(true);
  });

  it('path cost respects step costs', () => {
    const piece = makePiece({ pos: { r: 10, c: 10 } });
    const cost = pathCost(piece, [{ r: 10, c: 11 }, { r: 10, c: 12 }], [piece], []);
    expect(cost).toBe(2);
  });

  it('damaged path cost is doubled', () => {
    const piece = makePiece({ damaged: true, pos: { r: 10, c: 10 } });
    const cost = pathCost(piece, [{ r: 10, c: 11 }, { r: 10, c: 12 }], [piece], []);
    expect(cost).toBe(4);
  });
});

// ─── 5. Turn actions: attack/recon once per turn; A.C before moving ──────────

describe('Turn action rules', () => {
  it('cannot attack twice in a turn', () => {
    const state = makePlayState();
    const aAcorazado = state.pieces.find(p => p.owner === 'A' && p.type === 'Acorazado')!;
    const bPiece = state.pieces.find(p => p.owner === 'B')!;

    // Give A a token and set up for attack
    let s = selectNumberToken(state, state.numberTokens.A[0]) as GameState;
    s = attackPiece(s, aAcorazado.id, bPiece.id) as GameState;
    const second = attackPiece(s, aAcorazado.id, bPiece.id);
    expect(typeof second).toBe('string'); // error
  });

  it('A.C must attack before moving', () => {
    const state = makePlayState();
    const ac = state.pieces.find(p => p.owner === 'A' && p.type === 'AvionCombate')!;
    const bPiece = state.pieces.find(p => p.owner === 'B')!;

    let s = selectNumberToken(state, state.numberTokens.A[0]) as GameState;
    // Move first
    s = movePiece(s, ac.id, { r: ac.pos!.r + 1, c: ac.pos!.c }) as GameState;
    const result = attackPiece(s, ac.id, bPiece.id);
    expect(typeof result).toBe('string'); // error: must attack before moving
  });
});

// ─── 6. Mines ────────────────────────────────────────────────────────────────

describe('Mines', () => {
  it('non-minador/avion pieces are destroyed by mines', () => {
    const piece = makePiece({ type: 'Crucero', pos: { r: 10, c: 10 } });
    const mine = { r: 10, c: 11, owner: 'B' as const };
    const result = applyMove(piece, { r: 10, c: 11 }, { pieces: [piece], mines: [mine] });
    expect(result.destroyed).toBe(true);
    expect(result.mines).toHaveLength(0); // mine consumed
  });

  it('minador can pass over mines', () => {
    const minador = makePiece({ type: 'Minador', pos: { r: 10, c: 10 } });
    const mine = { r: 10, c: 11, owner: 'B' as const };
    const result = applyMove(minador, { r: 10, c: 11 }, { pieces: [minador], mines: [mine] });
    expect(result.destroyed).toBe(false);
  });

  it('avion can pass over mines', () => {
    const avion = makePiece({ type: 'AvionCombate', pos: { r: 10, c: 10 } });
    const mine = { r: 10, c: 11, owner: 'B' as const };
    const result = applyMove(avion, { r: 10, c: 11 }, { pieces: [avion], mines: [mine] });
    expect(result.destroyed).toBe(false);
  });

  it('minador can place and lift mines via engine', () => {
    const state = makePlayState();
    const minador = state.pieces.find(p => p.owner === 'A' && p.type === 'Minador')!;
    let s = selectNumberToken(state, state.numberTokens.A[0]) as GameState;
    const target = { r: minador.pos!.r + 1, c: minador.pos!.c };
    s = placeMine(s, minador.id, target) as GameState;
    expect(s.mines.some(m => m.r === target.r && m.c === target.c)).toBe(true);
    s = liftMine(s, minador.id, target) as GameState;
    expect(s.mines.some(m => m.r === target.r && m.c === target.c)).toBe(false);
  });

  it('mines do not block line of sight for ranged attacks', () => {
    const from = { r: 9, c: 5 };
    const pieces: Piece[] = [];
    const mines = [{ r: 10, c: 5, owner: 'A' as const }];
    const targets = getTargetableCells(from.r, from.c, 4, pieces, mines);
    expect(targets.some(t => t.r === 11 && t.c === 5)).toBe(true);
  });
});

// ─── 7. Victory condition ─────────────────────────────────────────────────────

describe('Victory', () => {
  it('player wins by moving a piece to the rival arrival zone', () => {
    let state = makePlayState();
    // Teleport A's Acorazado to r=18, c=10 (adjacent to arrivalB row 19)
    const aAco = state.pieces.find(p => p.owner === 'A' && p.type === 'Acorazado')!;
    state = {
      ...state,
      pieces: state.pieces.map(p =>
        p.id === aAco.id ? { ...p, pos: { r: 18, c: 10 } } : p
      ),
    };

    state = selectNumberToken(state, state.numberTokens.A[0]) as GameState;
    state = movePiece(state, aAco.id, { r: 19, c: 10 }) as GameState;

    expect(state.phase).toBe('finished');
    expect(state.winner).toBe('A');
  });
});

// ─── 8. Tokens and olvidos ───────────────────────────────────────────────────

describe('Number tokens', () => {
  it('token is transferred to opponent on end turn', () => {
    const state = makePlayState();
    let s = selectNumberToken(state, 3) as GameState;
    s = endTurn(s) as GameState;
    // After endTurn → handoffPlay; B should have 3
    expect(s.numberTokens.B).toContain(3);
    expect(s.numberTokens.A).not.toContain(3);
  });

  it('enforceOlvidos gives highest opponent tokens to reach 6', () => {
    const tokens = enforceOlvidos(
      { A: [2, 3, 4], B: [3, 4, 5, 6, 2, 5] },
      'A',
    );
    expect(tokens.A.length).toBe(6);
    expect(tokens.B.length).toBe(3);
    // A got the 3 highest from B: 6, 5, 5
    expect(tokens.A).toContain(6);
  });
});

// ─── 9. Random board generator ───────────────────────────────────────────────

describe('Board generator', () => {
  it('generates symmetric islands (180° rotation)', () => {
    const islands = generateRandomIslands();
    // Each island has exactly a matching rotated counterpart
    expect(islands.length % 2).toBe(0);

    for (let i = 0; i < islands.length; i += 2) {
      const a = islands[i].cells[0];
      const b = islands[i + 1].cells[0];
      expect(21 - a.r).toBe(b.r);
      expect(25 - a.c).toBe(b.c);
    }
  });
});
