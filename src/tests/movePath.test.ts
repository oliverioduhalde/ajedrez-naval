import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../engine/gameEngine';
import { findPath, getReachableCells } from '../engine/movement';
import type { GameState, Piece, UnitType } from '../engine/types';
import { useGameStore } from '../store/gameStore';

function piece(type: UnitType, pos: { r: number; c: number }, over: Partial<Piece> = {}): Piece {
  return { id: `A-${type}-0`, owner: 'A', type, pos, damaged: false, revealedTo: [], ...over };
}

function stateWith(pieces: Piece[], over: Partial<GameState> = {}): GameState {
  return { ...createInitialState(), pieces, phase: 'play', turn: 'A', selectedNumberToken: 4, movementBudgetSpent: 0, mines: [], ...over };
}

describe('findPath', () => {
  it('llega a toda casilla alcanzable con un camino de longitud <= presupuesto', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    const reachable = getReachableCells(p, 4, [p], []);
    expect(reachable.length).toBeGreaterThan(0);
    for (const cell of reachable) {
      if (cell.r === 10 && cell.c === 10) continue; // el origen figura como alcanzable, pero no es un destino
      const path = findPath(p, cell, [p], []);
      expect(path, `sin camino a ${cell.r},${cell.c}`).not.toBeNull();
      expect(path!.length).toBeLessThanOrEqual(4);
      expect(path![path!.length - 1]).toEqual(cell);
    }
  });

  it('rodea piezas ocupadas y no pasa por minas con barcos', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    const blocker = piece('Crucero', { r: 10, c: 11 }, { id: 'A-Crucero-0' });
    const path = findPath(p, { r: 10, c: 12 }, [p, blocker], [{ r: 9, c: 11, owner: 'B' }]);
    expect(path).not.toBeNull();
    expect(path!.some(c => c.r === 10 && c.c === 11)).toBe(false);
    expect(path!.some(c => c.r === 9 && c.c === 11)).toBe(false);
  });

  it('los aviones sí cruzan minas', () => {
    const p = piece('AvionCombate', { r: 10, c: 10 });
    const path = findPath(p, { r: 10, c: 12 }, [p], [{ r: 10, c: 11, owner: 'B' }]);
    expect(path).toEqual([{ r: 10, c: 11 }, { r: 10, c: 12 }]);
  });

  it('devuelve null para el mismo lugar', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    expect(findPath(p, { r: 10, c: 10 }, [p], [])).toBeNull();
  });
});

describe('doMove recorre el camino paso a paso', () => {
  beforeEach(() => {
    useGameStore.setState({ game: createInitialState() });
  });

  it('mueve a una casilla marcada a más de un paso y gasta el movimiento justo', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    useGameStore.setState({
      game: stateWith([p, piece('Fragata', { r: 2, c: 2 }, { id: 'B-x', owner: 'B' })]),
    });
    useGameStore.getState().selectPiece(p.id);
    useGameStore.getState().doMove({ r: 10, c: 13 });
    const s = useGameStore.getState();
    expect(s.ui.errorMessage).toBeNull();
    expect(s.game.pieces.find(x => x.id === p.id)!.pos).toEqual({ r: 10, c: 13 });
    expect(s.game.movementBudgetSpent).toBe(3);
    expect(s.ui.selectedPieceId).toBe(p.id);
  });

  it('no mueve nada si no alcanza el movimiento', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    useGameStore.setState({ game: stateWith([p], { selectedNumberToken: 2 }) });
    useGameStore.getState().selectPiece(p.id);
    useGameStore.getState().doMove({ r: 10, c: 14 });
    const s = useGameStore.getState();
    expect(s.game.pieces.find(x => x.id === p.id)!.pos).toEqual({ r: 10, c: 10 });
    expect(s.game.movementBudgetSpent).toBe(0);
    expect(s.ui.errorMessage).toMatch(/movimiento/i);
    // el error no suelta la selección
    expect(s.ui.selectedPieceId).toBe(p.id);
  });

  it('una pieza averiada gasta 2 por casilla', () => {
    const p = piece('Crucero', { r: 10, c: 10 }, { damaged: true });
    useGameStore.setState({ game: stateWith([p], { selectedNumberToken: 4 }) });
    useGameStore.getState().selectPiece(p.id);
    useGameStore.getState().doMove({ r: 10, c: 12 });
    expect(useGameStore.getState().game.movementBudgetSpent).toBe(4);
  });
});
