import type { Piece, Player, UnitType } from './types';
import { getSetupCells } from './board';

export interface Placement {
  pieceId: string;
  pos: { r: number; c: number };
}

// Cada grupo ocupa 2 filas x 3 columnas: fila de frente (hacia el rival) y fila de respaldo.
// Se expresa para el jugador A (zona filas 1-7, frente en fila 5, respaldo en fila 4).
const FRONT_ROW = 5;
const BACK_ROW = 4;

const TASK_FORCES: { anchorCol: number; front: UnitType[]; back: UnitType[] }[] = [
  { anchorCol: 12, front: ['Fragata', 'Acorazado', 'Submarino'], back: ['AvionCombate', 'Minador', 'AvionReconocimiento'] },
  { anchorCol: 6,  front: ['Fragata', 'Crucero', 'Minador'],     back: ['AvionCombate', 'AvionReconocimiento'] },
  { anchorCol: 19, front: ['Submarino', 'Crucero', 'Fragata'],   back: ['Minador', 'AvionCombate'] },
];

function rotate(r: number, c: number) {
  return { r: 21 - r, c: 25 - c };
}

function taskForceSlots(player: Player): { type: UnitType; r: number; c: number }[] {
  const out: { type: UnitType; r: number; c: number }[] = [];
  for (const tf of TASK_FORCES) {
    const place = (types: UnitType[], row: number) => {
      types.forEach((type, i) => {
        const c = tf.anchorCol - 1 + i;
        const pos = player === 'A' ? { r: row, c } : rotate(row, c);
        out.push({ type, ...pos });
      });
    };
    place(tf.front, FRONT_ROW);
    place(tf.back, BACK_ROW);
  }
  return out;
}

function nearestFree(
  target: { r: number; c: number },
  valid: { r: number; c: number }[],
  taken: Set<string>,
): { r: number; c: number } | null {
  let best: { r: number; c: number } | null = null;
  let bestD = Infinity;
  for (const cell of valid) {
    if (taken.has(`${cell.r},${cell.c}`)) continue;
    const d = Math.abs(cell.r - target.r) + Math.abs(cell.c - target.c);
    if (d < bestD) { best = cell; bestD = d; }
  }
  return best;
}

export function taskForceDeployment(player: Player, pieces: Piece[]): Placement[] {
  const valid = getSetupCells(player);
  const validSet = new Set(valid.map(c => `${c.r},${c.c}`));
  const taken = new Set<string>();
  const pool = pieces.filter(p => p.owner === player);
  const used = new Set<string>();
  const placements: Placement[] = [];

  for (const slot of taskForceSlots(player)) {
    const piece = pool.find(p => p.type === slot.type && !used.has(p.id));
    if (!piece) continue;
    const key = `${slot.r},${slot.c}`;
    const pos = validSet.has(key) && !taken.has(key) ? { r: slot.r, c: slot.c } : nearestFree(slot, valid, taken);
    if (!pos) continue;
    used.add(piece.id);
    taken.add(`${pos.r},${pos.c}`);
    placements.push({ pieceId: piece.id, pos });
  }

  for (const piece of pool) {
    if (used.has(piece.id)) continue;
    const pos = nearestFree({ r: FRONT_ROW, c: 12 }, valid, taken);
    if (!pos) break;
    taken.add(`${pos.r},${pos.c}`);
    placements.push({ pieceId: piece.id, pos });
  }
  return placements;
}

export function randomDeployment(player: Player, pieces: Piece[], rng: () => number = Math.random): Placement[] {
  const cells = getSetupCells(player).slice();
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  const pool = pieces.filter(p => p.owner === player);
  return pool.slice(0, cells.length).map((p, i) => ({ pieceId: p.id, pos: cells[i] }));
}
