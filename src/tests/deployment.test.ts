import { describe, it, expect } from 'vitest';
import { createInitialState } from '../engine/gameEngine';
import { getSetupCells } from '../engine/board';
import { randomDeployment, taskForceDeployment } from '../engine/deployment';
import { unplacePieceInSetup, placePieceInSetup } from '../engine/gameEngine';
import type { Player } from '../engine/types';

function clusters(cells: { r: number; c: number }[]): number[] {
  const left = new Set(cells.map(c => `${c.r},${c.c}`));
  const sizes: number[] = [];
  while (left.size) {
    const start = left.values().next().value as string;
    left.delete(start);
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const [r, c] = stack.pop()!.split(',').map(Number);
      size++;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const k = `${r + dr},${c + dc}`;
          if (left.has(k)) { left.delete(k); stack.push(k); }
        }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => a - b);
}

describe.each(['A', 'B'] as Player[])('despliegue del jugador %s', player => {
  const pieces = createInitialState().pieces;
  const valid = new Set(getSetupCells(player).map(c => `${c.r},${c.c}`));

  function check(placements: { pieceId: string; pos: { r: number; c: number } }[]) {
    expect(placements).toHaveLength(16);
    expect(new Set(placements.map(p => p.pieceId)).size).toBe(16);
    expect(new Set(placements.map(p => `${p.pos.r},${p.pos.c}`)).size).toBe(16);
    for (const p of placements) {
      expect(valid.has(`${p.pos.r},${p.pos.c}`)).toBe(true);
      expect(pieces.find(x => x.id === p.pieceId)!.owner).toBe(player);
    }
  }

  it('aleatorio: 16 piezas, celdas únicas y dentro de la zona', () => {
    check(randomDeployment(player, pieces));
  });

  it('task force: 16 piezas válidas formando exactamente 3 grupos (5, 5 y 6)', () => {
    const placements = taskForceDeployment(player, pieces);
    check(placements);
    expect(clusters(placements.map(p => p.pos))).toEqual([5, 5, 6]);
  });

  it('task force: cada grupo tiene su propia composición y la flota completa se respeta', () => {
    const placements = taskForceDeployment(player, pieces);
    const types = placements.map(p => pieces.find(x => x.id === p.pieceId)!.type);
    const count = (t: string) => types.filter(x => x === t).length;
    expect(count('Acorazado')).toBe(1);
    expect(count('Crucero')).toBe(2);
    expect(count('Fragata')).toBe(3);
    expect(count('Minador')).toBe(3);
    expect(count('Submarino')).toBe(2);
    expect(count('AvionCombate')).toBe(3);
    expect(count('AvionReconocimiento')).toBe(2);
  });
});

describe('devolver una pieza a la bandeja', () => {
  it('quita la posición y la marca de colocada, solo en despliegue y solo del jugador activo', () => {
    let state = createInitialState();
    const piece = state.pieces.find(p => p.owner === 'A')!;
    const placed = placePieceInSetup(state, piece.id, { r: 3, c: 5 });
    expect(typeof placed).not.toBe('string');
    state = placed as typeof state;
    const back = unplacePieceInSetup(state, piece.id);
    expect(typeof back).not.toBe('string');
    const next = back as typeof state;
    expect(next.pieces.find(p => p.id === piece.id)!.pos).toBeNull();
    expect(next.setupPlacedPieceIds).not.toContain(piece.id);

    const enemy = state.pieces.find(p => p.owner === 'B')!;
    expect(unplacePieceInSetup(state, enemy.id)).toBe('Not your piece');
  });
});
