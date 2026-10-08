import { isInBounds, getCellKind } from './board';
import type { Piece, Mine } from './types';

// Returns cells in a straight orthogonal line from (r,c) in direction (dr,dc),
// up to maxRange steps. Stops at board edge.
export function straightLine(
  r: number,
  c: number,
  dr: number,
  dc: number,
  maxRange: number,
): { r: number; c: number }[] {
  const cells: { r: number; c: number }[] = [];
  for (let step = 1; step <= maxRange; step++) {
    const nr = r + dr * step;
    const nc = c + dc * step;
    if (!isInBounds(nr, nc)) break;
    cells.push({ r: nr, c: nc });
  }
  return cells;
}

const ORTHOGONAL_DIRS = [
  { dr: -1, dc: 0 },
  { dr: 1, dc: 0 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
];

/**
 * Returns all cells that can be targeted from (r,c) with the given range,
 * blocked by islands and pieces (but NOT mines).
 * Returns objects { r, c } that are within range along an unobstructed line.
 */
export function getTargetableCells(
  r: number,
  c: number,
  range: number, // Infinity for unlimited
  pieces: Piece[],
  _mines: Mine[], // mines do NOT block line of sight
): { r: number; c: number }[] {
  const occupied = new Set(
    pieces.filter(p => p.pos).map(p => `${p.pos!.r},${p.pos!.c}`)
  );

  const results: { r: number; c: number }[] = [];
  const steps = range === Infinity ? 999 : range;

  for (const { dr, dc } of ORTHOGONAL_DIRS) {
    for (let step = 1; step <= steps; step++) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (!isInBounds(nr, nc)) break;

      const kind = getCellKind(nr, nc);
      if (kind === 'island') break; // island blocks LOS and is not targetable

      results.push({ r: nr, c: nc });

      // Any piece (own or enemy) blocks further sight down this line
      if (occupied.has(`${nr},${nc}`)) break;
    }
  }

  return results;
}

/**
 * Check if there is a clear orthogonal line of sight between two cells,
 * blocked by islands and any intermediate pieces (mines do NOT block).
 */
export function hasLineOfSight(
  from: { r: number; c: number },
  to: { r: number; c: number },
  pieces: Piece[],
): boolean {
  const dr = to.r - from.r;
  const dc = to.c - from.c;

  // Must be on same row or same column (orthogonal)
  if (dr !== 0 && dc !== 0) return false;
  if (dr === 0 && dc === 0) return false;

  const stepR = dr === 0 ? 0 : dr / Math.abs(dr);
  const stepC = dc === 0 ? 0 : dc / Math.abs(dc);
  const steps = Math.max(Math.abs(dr), Math.abs(dc));

  const occupied = new Set(
    pieces.filter(p => p.pos).map(p => `${p.pos!.r},${p.pos!.c}`)
  );

  for (let i = 1; i < steps; i++) {
    const nr = from.r + stepR * i;
    const nc = from.c + stepC * i;
    const kind = getCellKind(nr, nc);
    if (kind === 'island') return false;
    if (occupied.has(`${nr},${nc}`)) return false;
  }

  // Also check the target cell itself isn't an island
  const targetKind = getCellKind(to.r, to.c);
  if (targetKind === 'island') return false;

  return true;
}

export { ORTHOGONAL_DIRS };
