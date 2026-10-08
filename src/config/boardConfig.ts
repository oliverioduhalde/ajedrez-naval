export type Cell = { r: number; c: number };

export type CellKind =
  | 'sea'
  | 'island'
  | 'workshop'
  | 'bay'
  | 'arrivalA'
  | 'arrivalB';

// Bay behaviour flag — set true to make bays impassable
export const BAY_BLOCKS_MOVEMENT = false;

export const boardConfig = {
  cols: 24,
  rows: 20,
  foldBetweenCols: [12, 13] as const,

  startStrip: { A: { rows: [1, 7] as [number, number] }, B: { rows: [14, 20] as [number, number] } },
  openSea: { rows: [8, 13] as [number, number] },

  arrivalZone: {
    A: { rows: [1, 2] as [number, number], cols: [10, 15] as [number, number] },
    B: { rows: [19, 20] as [number, number], cols: [10, 15] as [number, number] },
  },
  zoneDock: {
    A: { workshops: [{ r: 1, c: 12 }, { r: 1, c: 13 }], bays: [{ r: 2, c: 12 }, { r: 2, c: 13 }] },
    B: { workshops: [{ r: 20, c: 12 }, { r: 20, c: 13 }], bays: [{ r: 19, c: 12 }, { r: 19, c: 13 }] },
  },
  sideDocks: [
    { workshop: { r: 10, c: 1 }, bays: [{ r: 9, c: 1 }, { r: 11, c: 1 }] },
    { workshop: { r: 11, c: 24 }, bays: [{ r: 10, c: 24 }, { r: 12, c: 24 }] },
  ],

  // 3 base islands + their 180° rotational counterparts
  // Rotation of (r,c) = (21-r, 25-c)
  islands: [
    { cells: [{ r: 5, c: 3 }, { r: 5, c: 4 }, { r: 6, c: 3 }] },
    { cells: [{ r: 16, c: 22 }, { r: 16, c: 21 }, { r: 15, c: 22 }] }, // rot of above
    { cells: [{ r: 7, c: 8 }, { r: 7, c: 9 }, { r: 8, c: 9 }] },
    { cells: [{ r: 14, c: 17 }, { r: 14, c: 16 }, { r: 13, c: 16 }] }, // rot of above
    { cells: [{ r: 6, c: 18 }, { r: 6, c: 19 }, { r: 7, c: 18 }] },
    { cells: [{ r: 15, c: 7 }, { r: 15, c: 6 }, { r: 14, c: 7 }] },   // rot of above
  ] as { cells: Cell[] }[],
} as const;

export const fireRange: Record<string, number | 'unlimited'> = {
  Acorazado: 6,
  Crucero: 4,
  Fragata: 2,
  Minador: 1,
  Submarino: 1,
  AvionCombate: 'unlimited',
  AvionReconocimiento: 'unlimited',
};
