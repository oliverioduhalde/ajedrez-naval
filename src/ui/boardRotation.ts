export type Rot = 0 | 90 | 180 | 270;
export type Side = 'top' | 'right' | 'bottom' | 'left';

export function displayDims(rot: Rot, cols: number, rows: number) {
  return rot === 90 || rot === 270 ? { dc: rows, dr: cols } : { dc: cols, dr: rows };
}

export function mapCell(rot: Rot, r: number, c: number, cols: number, rows: number) {
  switch (rot) {
    case 90:  return { row: c, col: rows + 1 - r };
    case 180: return { row: rows + 1 - r, col: cols + 1 - c };
    case 270: return { row: cols + 1 - c, col: r };
    default:  return { row: r, col: c };
  }
}

const ORDER: Side[] = ['top', 'right', 'bottom', 'left'];

export function mapSide(rot: Rot, side: Side): Side {
  return ORDER[(ORDER.indexOf(side) + rot / 90) % 4];
}

export function mapRect(rot: Rot, r1: number, c1: number, r2: number, c2: number, cols: number, rows: number) {
  const a = mapCell(rot, r1, c1, cols, rows);
  const b = mapCell(rot, r2, c2, cols, rows);
  const row0 = Math.min(a.row, b.row);
  const col0 = Math.min(a.col, b.col);
  return {
    left: col0 - 1,
    top: row0 - 1,
    width: Math.abs(a.col - b.col) + 1,
    height: Math.abs(a.row - b.row) + 1,
  };
}

export function sideBorder(side: Side): 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft' {
  switch (side) {
    case 'top': return 'borderTop';
    case 'right': return 'borderRight';
    case 'bottom': return 'borderBottom';
    default: return 'borderLeft';
  }
}
