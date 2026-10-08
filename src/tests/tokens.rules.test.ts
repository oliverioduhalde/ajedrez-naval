import { describe, expect, it } from 'vitest';
import {
  createInitialState, endTurn, confirmHandoff, finishSetup, movePiece, placePieceInSetup, selectNumberToken,
} from '../engine/gameEngine';
import { taskForceDeployment } from '../engine/deployment';
import { getCellKind } from '../engine/board';
import { boardConfig } from '../config/boardConfig';
import { initialTokens } from '../engine/tokens';
import type { GameState, Piece, UnitType } from '../engine/types';

function deployed(): GameState {
  let s = createInitialState();
  for (const player of ['A', 'B'] as const) {
    for (const pl of taskForceDeployment(player, s.pieces)) {
      s = placePieceInSetup(s, pl.pieceId, pl.pos) as GameState;
    }
    s = finishSetup(s) as GameState;
  }
  return confirmHandoff(s);
}

describe('fichas-número (reglamento §2.2)', () => {
  it('hay una única ficha "1": la tiene quien empieza, que arranca con 6; el otro con 5', () => {
    const t = initialTokens();
    expect(t.A).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t.B).toEqual([2, 3, 4, 5, 6]);
    expect([...t.A, ...t.B].filter(x => x === 1)).toHaveLength(1);
    expect(initialTokens('B').B).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('al terminar el despliegue nadie le saca fichas al rival', () => {
    const s = deployed();
    expect(s.phase).toBe('play');
    expect(s.turn).toBe('A');
    expect(s.numberTokens.A).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.numberTokens.B).toEqual([2, 3, 4, 5, 6]);
  });

  it('cada ficha jugada se entrega al rival y por eso aparecen repetidas; siempre 6 al empezar el turno', () => {
    let s = deployed();
    s = selectNumberToken(s, 4) as GameState;
    s = endTurn(s) as GameState;
    expect(s.numberTokens.A).toEqual([1, 2, 3, 5, 6]);
    expect(s.numberTokens.B).toEqual([2, 3, 4, 4, 5, 6]);
    s = confirmHandoff(s);
    s = selectNumberToken(s, 6) as GameState;
    s = endTurn(s) as GameState;
    expect(s.numberTokens.A).toHaveLength(6);
    expect(s.numberTokens.A.filter(x => x === 6)).toHaveLength(2);
    expect(s.numberTokens.B).toHaveLength(5);
  });
});

describe('las piezas nunca se encimen', () => {
  const piece = (type: UnitType, id: string, pos: { r: number; c: number }, owner: 'A' | 'B' = 'A'): Piece =>
    ({ id, owner, type, pos, damaged: false, revealedTo: [] });

  function playWith(pieces: Piece[]): GameState {
    return { ...createInitialState(), pieces, phase: 'play', turn: 'A', selectedNumberToken: 4, movementBudgetSpent: 0 };
  }

  it('no se entra a una casilla ocupada, ni propia ni rival, ni siquiera con aviones', () => {
    for (const type of ['Fragata', 'AvionCombate', 'AvionReconocimiento', 'Minador'] as UnitType[]) {
      const s = playWith([
        piece(type, 'A-x', { r: 10, c: 10 }),
        piece('Crucero', 'A-y', { r: 10, c: 11 }),
        piece('Crucero', 'B-y', { r: 9, c: 10 }, 'B'),
      ]);
      expect(movePiece(s, 'A-x', { r: 10, c: 11 })).toBe('Cell already occupied');
      expect(movePiece(s, 'A-x', { r: 9, c: 10 })).toBe('Cell already occupied');
      expect(typeof movePiece(s, 'A-x', { r: 11, c: 10 })).toBe('object');
    }
  });

  it('no se entra a una isla ni se sale del tablero', () => {
    const island = boardConfig.islands[0].cells[0];
    const next = [{ r: island.r, c: island.c + 1 }, { r: island.r, c: island.c - 1 }, { r: island.r + 1, c: island.c }, { r: island.r - 1, c: island.c }]
      .find(n => getCellKind(n.r, n.c) !== 'island')!;
    const s = playWith([piece('AvionCombate', 'A-x', next)]);
    expect(getCellKind(island.r, island.c)).toBe('island');
    expect(movePiece(s, 'A-x', island)).toBe('Destination is not navigable');
    const edge = playWith([piece('AvionCombate', 'A-x', { r: 1, c: 1 })]);
    expect(movePiece(edge, 'A-x', { r: 0, c: 1 })).toBe('Destination is not navigable');
  });
});
