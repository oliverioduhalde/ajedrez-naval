import type { Player, Piece, UnitType, UnitCategory } from './types';
import { fireRange } from '../config/boardConfig';

export function getCategory(type: UnitType): UnitCategory {
  if (type === 'Submarino') return 'submarino';
  if (type === 'AvionCombate' || type === 'AvionReconocimiento') return 'avion';
  return 'barco';
}

export function getNominalRange(type: UnitType): number {
  const r = fireRange[type];
  return r === 'unlimited' ? Infinity : r;
}

export function getActualRange(piece: Piece): number {
  const nominal = getNominalRange(piece.type);
  if (nominal === Infinity) return Infinity;
  if (piece.damaged) return Math.floor(nominal / 2);
  return nominal;
}

export function canBeDamaged(type: UnitType): boolean {
  return getCategory(type) === 'barco';
}

// Fleet composition: 16 pieces per player
const FLEET_COMPOSITION: { type: UnitType; count: number }[] = [
  { type: 'Acorazado', count: 1 },
  { type: 'Crucero', count: 2 },
  { type: 'Fragata', count: 3 },
  { type: 'Minador', count: 3 },
  { type: 'Submarino', count: 2 },
  { type: 'AvionCombate', count: 3 },
  { type: 'AvionReconocimiento', count: 2 },
];

export function createFleet(player: Player): Piece[] {
  const pieces: Piece[] = [];
  let idx = 0;
  for (const { type, count } of FLEET_COMPOSITION) {
    for (let i = 0; i < count; i++) {
      pieces.push({
        id: `${player}-${type}-${i}`,
        owner: player,
        type,
        pos: null,
        damaged: false,
        revealedTo: [],
      });
      idx++;
    }
  }
  return pieces;
}

// Can a minador-type piece pass over mines?
export function canPassMines(type: UnitType): boolean {
  return type === 'Minador' || type === 'AvionCombate' || type === 'AvionReconocimiento';
}

export function pieceLabel(type: UnitType): string {
  switch (type) {
    case 'Acorazado': return 'A';
    case 'Crucero': return 'C';
    case 'Fragata': return 'F';
    case 'Minador': return 'M';
    case 'Submarino': return 'S';
    case 'AvionCombate': return 'A.C';
    case 'AvionReconocimiento': return 'A.R';
  }
}
