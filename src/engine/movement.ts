import { isInBounds, getCellKind, isPassable } from './board';
import { canPassMines } from './pieces';
import type { Piece, Mine } from './types';
import { ORTHOGONAL_DIRS } from './lineOfSight';

/**
 * Get all cells reachable from piece.pos using up to `budget` movement points.
 * Damaged pieces cost 2 points per cell.
 */
export function getReachableCells(
  piece: Piece,
  budget: number,
  pieces: Piece[],
  mines: Mine[],
): { r: number; c: number }[] {
  if (!piece.pos || budget <= 0) return [];

  const mineSet = new Set(mines.map(m => `${m.r},${m.c}`));
  const occupied = new Set(
    pieces.filter(p => p.pos && p.id !== piece.id).map(p => `${p.pos!.r},${p.pos!.c}`)
  );

  const stepCost = piece.damaged ? 2 : 1;
  const reachable = new Set<string>();
  // visited key -> max remaining budget when reached (to prune revisits)
  const visited = new Map<string, number>();

  function dfs(r: number, c: number, remaining: number) {
    for (const { dr, dc } of ORTHOGONAL_DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!isInBounds(nr, nc)) continue;

      const kind = getCellKind(nr, nc);
      if (kind === 'island') continue;

      const isMined = mineSet.has(`${nr},${nc}`);
      if (isMined && !canPassMines(piece.type)) continue;

      if (occupied.has(`${nr},${nc}`)) continue;

      if (remaining < stepCost) continue;

      const leftAfter = remaining - stepCost;
      const k = `${nr},${nc}`;
      const prevBest = visited.get(k) ?? -1;
      if (leftAfter <= prevBest) continue;
      visited.set(k, leftAfter);

      reachable.add(k);
      dfs(nr, nc, leftAfter);
    }
  }

  dfs(piece.pos.r, piece.pos.c, budget);

  return Array.from(reachable).map(k => {
    const [r, c] = k.split(',').map(Number);
    return { r, c };
  });
}

/**
 * Compute cost to move piece along a sequence of cells (must be adjacent steps).
 * Returns total cost, or null if path is illegal.
 */
export function pathCost(
  piece: Piece,
  path: { r: number; c: number }[],
  pieces: Piece[],
  mines: Mine[],
): number | null {
  if (!piece.pos) return null;
  const mineSet = new Set(mines.map(m => `${m.r},${m.c}`));
  const occupied = new Set(
    pieces.filter(p => p.pos && p.id !== piece.id).map(p => `${p.pos!.r},${p.pos!.c}`)
  );
  const stepCost = piece.damaged ? 2 : 1;
  let total = 0;
  let cur = piece.pos;

  for (const next of path) {
    const dr = Math.abs(next.r - cur.r);
    const dc = Math.abs(next.c - cur.c);
    const isAdjacent = (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
    if (!isAdjacent) return null;
    if (!isPassable(next.r, next.c)) return null;
    const isMined = mineSet.has(`${next.r},${next.c}`);
    if (isMined && !canPassMines(piece.type)) return null;
    if (occupied.has(`${next.r},${next.c}`)) return null;
    total += stepCost;
    cur = next;
  }

  return total;
}

/**
 * Apply move: returns updated pieces and mines arrays.
 * Handles mine explosion (if piece can't pass mines) and workshop repair.
 */
export function applyMove(
  piece: Piece,
  destination: { r: number; c: number },
  state: { pieces: Piece[]; mines: Mine[] },
): {
  pieces: Piece[];
  mines: Mine[];
  destroyed: boolean;
  repairedAt: { r: number; c: number } | null;
} {
  const dest = destination;
  const mineAtDest = state.mines.find(m => m.r === dest.r && m.c === dest.c);
  let destroyed = false;
  let newMines = state.mines;
  let repairedAt: { r: number; c: number } | null = null;

  if (mineAtDest && !canPassMines(piece.type)) {
    destroyed = true;
    newMines = state.mines.filter(m => !(m.r === dest.r && m.c === dest.c));
  }

  const kind = getCellKind(dest.r, dest.c);
  const repaired = !destroyed && piece.damaged && kind === 'workshop';
  if (repaired) repairedAt = dest;

  const newPieces = state.pieces.map(p => {
    if (p.id !== piece.id) return p;
    if (destroyed) return { ...p, pos: null };
    return { ...p, pos: dest, damaged: repaired ? false : p.damaged };
  });

  return { pieces: newPieces, mines: newMines, destroyed, repairedAt };
}

/**
 * Camino más corto (casilla por casilla, sin incluir el origen) desde piece.pos
 * hasta `dest`, con las mismas restricciones que `getReachableCells`:
 * sin islas, sin casillas ocupadas y sin minas salvo piezas que las cruzan.
 * Devuelve null si no hay camino.
 */
export function findPath(
  piece: Piece,
  dest: { r: number; c: number },
  pieces: Piece[],
  mines: Mine[],
): { r: number; c: number }[] | null {
  if (!piece.pos) return null;
  const start = piece.pos;
  if (start.r === dest.r && start.c === dest.c) return null;

  const mineSet = new Set(mines.map(m => `${m.r},${m.c}`));
  const occupied = new Set(
    pieces.filter(p => p.pos && p.id !== piece.id).map(p => `${p.pos!.r},${p.pos!.c}`)
  );
  const key = (r: number, c: number) => `${r},${c}`;
  const parent = new Map<string, string | null>([[key(start.r, start.c), null]]);
  const queue: { r: number; c: number }[] = [start];

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    for (const { dr, dc } of ORTHOGONAL_DIRS) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      const k = key(nr, nc);
      if (!isInBounds(nr, nc) || parent.has(k)) continue;
      if (getCellKind(nr, nc) === 'island') continue;
      if (mineSet.has(k) && !canPassMines(piece.type)) continue;
      if (occupied.has(k)) continue;
      parent.set(k, key(cur.r, cur.c));
      if (nr === dest.r && nc === dest.c) {
        const path: { r: number; c: number }[] = [];
        let at: string | null = k;
        while (at && at !== key(start.r, start.c)) {
          const [r, c] = at.split(',').map(Number);
          path.push({ r, c });
          at = parent.get(at) ?? null;
        }
        return path.reverse();
      }
      queue.push({ r: nr, c: nc });
    }
  }
  return null;
}
