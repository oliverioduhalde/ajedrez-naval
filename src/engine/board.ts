import { boardConfig, type Cell, type CellKind, BAY_BLOCKS_MOVEMENT } from '../config/boardConfig';

// Build a lookup map of (r,c) -> CellKind
function buildCellMap(): Map<string, CellKind> {
  const map = new Map<string, CellKind>();
  const key = (r: number, c: number) => `${r},${c}`;

  // Default: sea
  for (let r = 1; r <= boardConfig.rows; r++)
    for (let c = 1; c <= boardConfig.cols; c++)
      map.set(key(r, c), 'sea');

  // Islands
  for (const island of boardConfig.islands)
    for (const cell of island.cells)
      map.set(key(cell.r, cell.c), 'island');

  // Zone docks (workshops + bays)
  for (const player of ['A', 'B'] as const) {
    for (const w of boardConfig.zoneDock[player].workshops)
      map.set(key(w.r, w.c), 'workshop');
    for (const b of boardConfig.zoneDock[player].bays)
      map.set(key(b.r, b.c), 'bay');
  }

  // Side docks
  for (const dock of boardConfig.sideDocks) {
    map.set(key(dock.workshop.r, dock.workshop.c), 'workshop');
    for (const b of dock.bays)
      map.set(key(b.r, b.c), 'bay');
  }

  // Arrival zones — set AFTER workshops/bays so workshops inside zone stay 'workshop'
  const az = boardConfig.arrivalZone;
  for (let r = az.A.rows[0]; r <= az.A.rows[1]; r++)
    for (let c = az.A.cols[0]; c <= az.A.cols[1]; c++) {
      const k = map.get(key(r, c));
      if (k !== 'workshop' && k !== 'bay')
        map.set(key(r, c), 'arrivalA');
    }
  for (let r = az.B.rows[0]; r <= az.B.rows[1]; r++)
    for (let c = az.B.cols[0]; c <= az.B.cols[1]; c++) {
      const k = map.get(key(r, c));
      if (k !== 'workshop' && k !== 'bay')
        map.set(key(r, c), 'arrivalB');
    }

  return map;
}

export const cellMap = buildCellMap();

export function getCellKind(r: number, c: number): CellKind {
  return cellMap.get(`${r},${c}`) ?? 'sea';
}

export function isInBounds(r: number, c: number): boolean {
  return r >= 1 && r <= boardConfig.rows && c >= 1 && c <= boardConfig.cols;
}

export function isPassable(r: number, c: number): boolean {
  if (!isInBounds(r, c)) return false;
  const kind = getCellKind(r, c);
  if (kind === 'island') return false;
  if (BAY_BLOCKS_MOVEMENT && kind === 'bay') return false;
  return true;
}

export function isArrivalZone(r: number, c: number, player: 'A' | 'B'): boolean {
  const kind = getCellKind(r, c);
  return player === 'A' ? kind === 'arrivalA' : kind === 'arrivalB';
}

export function isWorkshop(r: number, c: number): boolean {
  return getCellKind(r, c) === 'workshop';
}

// For setup: valid placement cells for a player (their start strip, passable)
export function getSetupCells(player: 'A' | 'B'): Cell[] {
  const strip = boardConfig.startStrip[player].rows;
  const cells: Cell[] = [];
  for (let r = strip[0]; r <= strip[1]; r++)
    for (let c = 1; c <= boardConfig.cols; c++)
      if (isPassable(r, c)) cells.push({ r, c });
  return cells;
}

// Generate random symmetric islands (180° rotation) — always 6 cells (3 pairs)
export function generateRandomIslands(): { cells: Cell[] }[] {
  const forbidden = new Set<string>();
  const key = (r: number, c: number) => `${r},${c}`;

  // Mark permanently forbidden cells (arrival zones, docks)
  const az = boardConfig.arrivalZone;
  for (let r = az.A.rows[0]; r <= az.A.rows[1]; r++)
    for (let c = az.A.cols[0]; c <= az.A.cols[1]; c++)
      forbidden.add(key(r, c));
  for (let r = az.B.rows[0]; r <= az.B.rows[1]; r++)
    for (let c = az.B.cols[0]; c <= az.B.cols[1]; c++)
      forbidden.add(key(r, c));
  for (const d of boardConfig.sideDocks) {
    forbidden.add(key(d.workshop.r, d.workshop.c));
    for (const b of d.bays) forbidden.add(key(b.r, b.c));
  }

  const islands: { cells: Cell[] }[] = [];
  const used = new Set<string>();

  const rot = (r: number, c: number) => ({ r: 21 - r, c: 25 - c });

  for (let attempt = 0; attempt < 300 && islands.length < 3; attempt++) {
    const r = Math.floor(Math.random() * 16) + 3; // rows 3-18
    const c = Math.floor(Math.random() * 22) + 2; // cols 2-23
    const { r: r2, c: c2 } = rot(r, c);

    if (forbidden.has(key(r, c)) || forbidden.has(key(r2, c2))) continue;
    if (used.has(key(r, c)) || used.has(key(r2, c2))) continue;
    if (r === r2 && c === c2) continue; // center point

    used.add(key(r, c));
    used.add(key(r2, c2));
    islands.push({ cells: [{ r, c }] });
    islands.push({ cells: [{ r: r2, c: c2 }] });
  }

  return islands;
}
