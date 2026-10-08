import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine/gameEngine';
import type { GameState, Piece, UnitType } from '../engine/types';
import { getPieceActions, modeHint, MAX_MINES } from '../ui/pieceActions';
import { placeMenu, type DisplayRect } from '../ui/components/PieceActionMenu';

function playState(over: Partial<GameState> = {}): GameState {
  return { ...createInitialState(), phase: 'play', turn: 'A', selectedNumberToken: 4, movementBudgetSpent: 0, ...over };
}

function piece(type: UnitType, over: Partial<Piece> = {}): Piece {
  return { id: `A-${type}-0`, owner: 'A', type, pos: { r: 5, c: 5 }, damaged: false, revealedTo: [], ...over };
}

const modes = (g: GameState, p: Piece) => getPieceActions(g, p).map(a => a.mode);
const find = (g: GameState, p: Piece, mode: string) => getPieceActions(g, p).find(a => a.mode === mode);

describe('acciones por tipo de ficha', () => {
  it.each(['Acorazado', 'Crucero', 'Fragata', 'Submarino', 'AvionCombate'] as UnitType[])(
    '%s: mueve y ataca, sin minas ni reconocimiento', type => {
      expect(modes(playState(), piece(type))).toEqual(['moving', 'attacking']);
    });

  it('Minador: mueve, ataca y coloca/levanta minas, pero no reconoce', () => {
    expect(modes(playState({ mines: [{ r: 9, c: 9, owner: 'B' }] }), piece('Minador')))
      .toEqual(['moving', 'attacking', 'placingMine', 'liftingMine']);
  });

  it('Avión de reconocimiento: mueve y reconoce, sin atacar ni minas', () => {
    expect(modes(playState(), piece('AvionReconocimiento'))).toEqual(['moving', 'reconning']);
  });

  it('solo el Minador puede minar y solo el reconocimiento reconoce (ningún otro tipo)', () => {
    const all: UnitType[] = ['Acorazado', 'Crucero', 'Fragata', 'Minador', 'Submarino', 'AvionCombate', 'AvionReconocimiento'];
    for (const t of all) {
      const m = modes(playState(), piece(t));
      expect(m.includes('placingMine')).toBe(t === 'Minador');
      expect(m.includes('liftingMine')).toBe(t === 'Minador');
      expect(m.includes('reconning')).toBe(t === 'AvionReconocimiento');
      expect(m.includes('attacking')).toBe(t !== 'AvionReconocimiento');
    }
  });
});

describe('disponibilidad según el estado del turno', () => {
  it('sin ficha de movimiento elegida todo está deshabilitado', () => {
    const g = playState({ selectedNumberToken: null });
    for (const t of ['Acorazado', 'AvionReconocimiento'] as UnitType[]) {
      expect(getPieceActions(g, piece(t)).filter(a => a.mode !== 'placingMine' && a.mode !== 'liftingMine').every(a => !a.enabled)).toBe(true);
    }
  });

  it('mover se deshabilita al agotar el movimiento', () => {
    expect(find(playState({ movementBudgetSpent: 4 }), piece('Fragata'), 'moving')?.enabled).toBe(false);
    expect(find(playState({ movementBudgetSpent: 3 }), piece('Fragata'), 'moving')?.enabled).toBe(true);
  });

  it('una pieza averiada necesita 2 de movimiento por casilla', () => {
    const dmg = piece('Crucero', { damaged: true });
    expect(find(playState({ movementBudgetSpent: 3 }), dmg, 'moving')?.enabled).toBe(false);
    expect(find(playState({ movementBudgetSpent: 2 }), dmg, 'moving')?.enabled).toBe(true);
  });

  it('atacar y reconocer comparten un uso por turno', () => {
    const g = playState({ attackOrReconUsedThisTurn: true });
    expect(find(g, piece('Acorazado'), 'attacking')?.enabled).toBe(false);
    expect(find(g, piece('AvionReconocimiento'), 'reconning')?.enabled).toBe(false);
  });

  it('el Avión de combate solo ataca antes de moverse y una vez', () => {
    expect(find(playState(), piece('AvionCombate'), 'attacking')?.enabled).toBe(true);
    expect(find(playState({ movementBudgetSpent: 1 }), piece('AvionCombate'), 'attacking')?.enabled).toBe(false);
    expect(find(playState({ combatPlaneAttackUsedThisTurn: true }), piece('AvionCombate'), 'attacking')?.enabled).toBe(false);
  });

  it('colocar mina se deshabilita al llegar al máximo y levantar sin minas en el tablero', () => {
    const mines = Array.from({ length: MAX_MINES }, (_, i) => ({ r: 10, c: i + 1, owner: 'A' as const }));
    const full = playState({ mines });
    expect(find(full, piece('Minador'), 'placingMine')?.enabled).toBe(false);
    expect(find(full, piece('Minador'), 'liftingMine')?.enabled).toBe(true);
    const empty = playState({ mines: [] });
    expect(find(empty, piece('Minador'), 'placingMine')?.enabled).toBe(true);
    expect(find(empty, piece('Minador'), 'liftingMine')?.enabled).toBe(false);
  });

  it('el texto de minas restantes usa singular cuando queda una', () => {
    const mines = Array.from({ length: MAX_MINES - 1 }, (_, i) => ({ r: 10, c: i + 1, owner: 'A' as const }));
    expect(find(playState({ mines }), piece('Minador'), 'placingMine')?.detail).toBe('te queda 1');
  });

  it('las minas del rival no gastan las 15 propias', () => {
    const mines = Array.from({ length: MAX_MINES }, (_, i) => ({ r: 10, c: i + 1, owner: 'B' as const }));
    expect(find(playState({ mines }), piece('Minador'), 'placingMine')?.enabled).toBe(true);
  });
});

describe('indicaciones', () => {
  it('avisan cuando no hay blancos', () => {
    expect(modeHint('attacking', { reachable: 0, targets: 0 })).toMatch(/No hay rivales/);
    expect(modeHint('attacking', { reachable: 0, targets: 2 })).toMatch(/rojo/);
    expect(modeHint('moving', { reachable: 0, targets: 0 })).toMatch(/No hay casillas/);
  });
});

describe('colocación del menú', () => {
  const cell = (left: number, top: number): DisplayRect => ({ left, top, width: 30, height: 30 });
  const W = 200, H = 120;
  const B = (width: number, height: number): DisplayRect => ({ left: 0, top: 0, width, height });

  it('prefiere el lado derecho cuando entra', () => {
    const p = placeMenu(cell(40, 200), W, H, B(720, 600), []);
    expect(p.side).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(70);
  });

  it('pasa a la izquierda en el borde derecho', () => {
    const p = placeMenu(cell(680, 200), W, H, B(720, 600), []);
    expect(p.side).toBe('left');
    expect(p.left + W).toBeLessThanOrEqual(680);
  });

  it('evita tapar las casillas importantes', () => {
    const avoid: DisplayRect[] = [cell(80, 205)];
    const p = placeMenu(cell(40, 200), W, H, B(720, 600), avoid);
    expect(p.side).not.toBe('right');
  });

  it('siempre queda dentro del tablero, incluso si es muy chico', () => {
    const p = placeMenu(cell(10, 10), W, H, B(220, 140), []);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.left + W).toBeLessThanOrEqual(220);
    expect(p.top + H).toBeLessThanOrEqual(140);
  });

  it('con zoom, se queda dentro del área visible y no del tablero entero', () => {
    // tablero 1800x1500 pero solo se ve una ventana de 400x300 desplazada
    const visible: DisplayRect = { left: 800, top: 600, width: 400, height: 300 };
    const p = placeMenu(cell(1100, 700), W, H, visible, []);
    expect(p.left).toBeGreaterThanOrEqual(visible.left);
    expect(p.left + W).toBeLessThanOrEqual(visible.left + visible.width);
    expect(p.top).toBeGreaterThanOrEqual(visible.top);
    expect(p.top + H).toBeLessThanOrEqual(visible.top + visible.height);
  });

  it('abajo/arriba cuando a los costados no hay lugar', () => {
    const p = placeMenu(cell(100, 60), W, H, B(230, 600), []);
    expect(['below', 'above']).toContain(p.side);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.left + W).toBeLessThanOrEqual(230);
  });
});
