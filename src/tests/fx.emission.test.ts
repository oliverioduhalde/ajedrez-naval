import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../engine/gameEngine';
import type { GameState, Piece, UnitType } from '../engine/types';
import type { FxEvent } from '../fx/types';

const emitted: FxEvent[] = [];
vi.mock('../fx/emit', () => ({ emitFx: (ev: FxEvent) => { emitted.push(ev); } }));

const { useGameStore } = await import('../store/gameStore');
const { useSettings } = await import('../store/settingsStore');

function piece(type: UnitType, pos: { r: number; c: number }, over: Partial<Piece> = {}): Piece {
  return { id: `A-${type}-0`, owner: 'A', type, pos, damaged: false, revealedTo: [], ...over };
}

function stateWith(pieces: Piece[], over: Partial<GameState> = {}): GameState {
  return { ...createInitialState(), pieces, phase: 'play', turn: 'A', selectedNumberToken: 5, movementBudgetSpent: 0, mines: [], ...over };
}

beforeEach(() => {
  emitted.length = 0;
  useSettings.setState({ vsCpu: false });
});

describe('el store emite los hechos de la partida a los efectos', () => {
  it('mover emite el recorrido completo y es audible para el que mueve', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    useGameStore.setState({ game: stateWith([p, piece('Fragata', { r: 2, c: 2 }, { id: 'B-x', owner: 'B' })]) });
    useGameStore.getState().selectPiece(p.id);
    useGameStore.getState().doMove({ r: 10, c: 12 });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      kind: 'move', pieceId: p.id, unit: 'Fragata', owner: 'A', from: { r: 10, c: 10 }, audible: true, endsInBlast: false,
    });
    expect((emitted[0] as Extract<FxEvent, { kind: 'move' }>).path).toEqual([{ r: 10, c: 11 }, { r: 10, c: 12 }]);
  });

  it('un movimiento rechazado no emite nada', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    useGameStore.setState({ game: stateWith([p], { selectedNumberToken: 1 }) });
    useGameStore.getState().selectPiece(p.id);
    useGameStore.getState().doMove({ r: 10, c: 14 });
    expect(emitted).toEqual([]);
  });

  it('niebla de guerra contra la CPU: su ficha oculta se mueve sin sonar, la revelada sí', () => {
    useSettings.setState({ vsCpu: true });
    const hidden = piece('Submarino', { r: 12, c: 10 }, { id: 'B-sub', owner: 'B' });
    const mine = piece('Fragata', { r: 3, c: 3 });
    useGameStore.setState({ game: stateWith([mine, hidden], { turn: 'B' }) });
    useGameStore.getState().selectPiece(hidden.id);
    useGameStore.getState().doMove({ r: 12, c: 11 });
    expect(emitted[0]).toMatchObject({ kind: 'move', unit: 'Submarino', audible: false });

    emitted.length = 0;
    const revealed = { ...hidden, pos: { r: 12, c: 11 }, revealedTo: ['A' as const] };
    useGameStore.setState({ game: stateWith([mine, revealed], { turn: 'B' }) });
    useGameStore.getState().selectPiece(revealed.id);
    useGameStore.getState().doMove({ r: 12, c: 12 });
    expect(emitted[0]).toMatchObject({ kind: 'move', audible: true });
  });

  it('en mesa compartida siempre suena la ficha de quien mueve', () => {
    const hidden = piece('Submarino', { r: 12, c: 10 }, { id: 'B-sub', owner: 'B' });
    useGameStore.setState({ game: stateWith([piece('Fragata', { r: 3, c: 3 }), hidden], { turn: 'B' }) });
    useGameStore.getState().selectPiece(hidden.id);
    useGameStore.getState().doMove({ r: 12, c: 11 });
    expect(emitted[0]).toMatchObject({ kind: 'move', audible: true });
  });

  it('entrar a una mina emite el movimiento (sonido cortado) y la explosión en la última casilla', () => {
    const p = piece('Fragata', { r: 10, c: 10 });
    const mines = [{ r: 10, c: 11, owner: 'B' as const }];
    useGameStore.setState({ game: stateWith([p, piece('Fragata', { r: 2, c: 2 }, { id: 'B-x', owner: 'B' })], { mines }) });
    useGameStore.getState().selectPiece(p.id);
    // la búsqueda de camino evita la mina, así que doMove cae al paso directo y el motor la hace estallar
    useGameStore.getState().doMove({ r: 10, c: 11 });
    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ kind: 'move', endsInBlast: true });
    expect(emitted[1]).toMatchObject({ kind: 'mineBlast', unit: 'Fragata', owner: 'A', at: { r: 10, c: 11 } });
  });

  it('atacar emite atacante, blanco, distancia y resultado real del combate', () => {
    const a = piece('Acorazado', { r: 10, c: 5 });
    const t = piece('Crucero', { r: 10, c: 9 }, { id: 'B-Crucero-0', owner: 'B' });
    useGameStore.setState({ game: stateWith([a, t]) });
    useGameStore.getState().selectPiece(a.id);
    useGameStore.getState().doAttack(t.id);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      kind: 'attack', attackerUnit: 'Acorazado', attackerOwner: 'A', from: { r: 10, c: 5 },
      targetUnit: 'Crucero', targetOwner: 'B', to: { r: 10, c: 9 }, distance: 4, result: 'HUNDIDO', targetWasDamaged: false,
    });
  });

  it('un ataque fuera de alcance no emite nada', () => {
    const a = piece('Fragata', { r: 10, c: 5 });
    const t = piece('Crucero', { r: 10, c: 12 }, { id: 'B-Crucero-0', owner: 'B' });
    useGameStore.setState({ game: stateWith([a, t]) });
    useGameStore.getState().selectPiece(a.id);
    useGameStore.getState().doAttack(t.id);
    expect(emitted).toEqual([]);
  });

  it('un barco que ataca a otro de mayor alcance lo deja averiado', () => {
    const a = piece('Crucero', { r: 10, c: 5 });
    const t = piece('Acorazado', { r: 10, c: 8 }, { id: 'B-Acorazado-0', owner: 'B' });
    useGameStore.setState({ game: stateWith([a, t]) });
    useGameStore.getState().selectPiece(a.id);
    useGameStore.getState().doAttack(t.id);
    expect(emitted[0]).toMatchObject({ kind: 'attack', result: 'AVERIADO' });
  });
});
