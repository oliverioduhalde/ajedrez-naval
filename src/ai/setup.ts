import type { Player, UnitType } from '../engine/types';
import type { Cell, CpuLevel, Placement } from './types';
import type { SetupContext, ViewPiece } from './view';
import { boardConfig } from '../config/boardConfig';
import { getCellKind, getSetupCells } from '../engine/board';
import { BOARD_COLS, ISLAND_GRID, cellIdx, inBoard } from './actions';
import { pick } from './rng';

/** Probabilidad de que una pieza se ubique con criterio (si no, cae en una celda cualquiera de la franja). */
const CRITERIA: Record<CpuLevel, number> = { 1: 0, 2: 0.25, 3: 0.6, 4: 0.85, 5: 1 };
/** Ruido uniforme +-JITTER sumado al puntaje de cada celda: variedad entre partidas. */
const JITTER: Record<CpuLevel, number> = { 1: 0, 2: 1, 3: 0.9, 4: 0.55, 5: 0.3 };
/** Los niveles bajos no revisan que el despliegue quede en un solo grupo. */
const REPAIR_FROM_LEVEL = 3;

const STRIPS = boardConfig.startStrip;
/** Dos piezas estan "unidas" si distan a lo sumo esto (Manhattan); el despliegue debe ser un solo grupo. */
const LINK_RADIUS = 2;

/** Profundidad objetivo (0 = fila de casa, 6 = primera fila frente al rival) y pesos por tipo. */
const PROFILE: Record<UnitType, { depth: number; depthW: number; centerW: number }> = {
  Acorazado: { depth: 6, depthW: 0.4, centerW: 0.3 },
  Crucero: { depth: 5.5, depthW: 0.35, centerW: 0.12 },
  Fragata: { depth: 4, depthW: 0.25, centerW: 0.08 },
  Submarino: { depth: 3, depthW: 0.25, centerW: 0.08 },
  Minador: { depth: 1.5, depthW: 0.25, centerW: 0 },
  AvionCombate: { depth: 2, depthW: 0.45, centerW: 0 },
  AvionReconocimiento: { depth: 1.5, depthW: 0.45, centerW: 0 },
};

/** Linea de vision de los aviones: libre hasta el rival, tapada por un barco propio (nunca se destapa) o por una isla (depende de cuan lejos). */
const LANE_CLEAR = 1.6;
const LANE_OWN = -1.6;
const LANE_ISLAND_BASE = -1;
const LANE_ISLAND_STEP = 0.2;
const LANE_ISLAND_CAP = 8;

const GUNSHIPS: ReadonlySet<UnitType> = new Set<UnitType>(['Acorazado', 'Crucero']);
const PLANES: ReadonlySet<UnitType> = new Set<UnitType>(['AvionCombate', 'AvionReconocimiento']);

type MinadorMode = 'dock' | 'flank';

interface Placed {
  id: string;
  type: UnitType;
  r: number;
  c: number;
}

interface Layout {
  player: Player;
  /** +1 si el frente de `player` esta hacia filas mayores (A), -1 si hacia menores (B). */
  fwd: 1 | -1;
  /** Columna alrededor de la cual se arma la formacion. */
  center: number;
  enemyFrontRow: number;
  workshops: readonly Cell[];
  placed: Placed[];
  enemy: Set<number>;
  paired: Set<string>;
}

function depthOf(player: Player, r: number): number {
  return player === 'A' ? r - STRIPS.A.rows[0] : STRIPS.B.rows[1] - r;
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

/** Calidad de la columna delante de un avion en (r, c): hasta donde ve antes de que algo propio o una isla le tape la vista. */
function laneScore(l: Layout, r: number, c: number): number {
  const own = new Set<number>();
  for (const p of l.placed) own.add(cellIdx(p.r, p.c));
  let steps = 0;
  for (let rr = r + l.fwd; inBoard(rr, c); rr += l.fwd) {
    steps++;
    const i = cellIdx(rr, c);
    if (l.enemy.has(i)) return LANE_CLEAR;
    if (ISLAND_GRID[i]) return LANE_ISLAND_BASE + LANE_ISLAND_STEP * Math.min(steps, LANE_ISLAND_CAP);
    if (own.has(i)) return LANE_OWN;
    if (rr === l.enemyFrontRow) return LANE_CLEAR;
  }
  return LANE_CLEAR;
}

function scoreCell(l: Layout, piece: ViewPiece, mode: MinadorMode | null, r: number, c: number): number {
  const type = piece.type as UnitType;
  const prof = PROFILE[type];
  const depth = depthOf(l.player, r);
  let s = 0;

  const target = type === 'Minador' && mode === 'flank' ? 2.5 : prof.depth;
  s -= prof.depthW * (depth - target) ** 2;
  s -= prof.centerW * Math.abs(c - l.center);

  if (l.placed.length > 0) {
    let n1 = 0;
    let n2 = 0;
    let nearestCore = Infinity;
    for (const q of l.placed) {
      const d = Math.abs(q.r - r) + Math.abs(q.c - c);
      if (d <= 1) n1++;
      if (d <= LINK_RADIUS) n2++;
      if (!PLANES.has(q.type) && d < nearestCore) nearestCore = d;
    }
    s += 0.5 * Math.min(n2, 2) + (n1 > 0 ? 0.3 : 0);
    if (n2 === 0) s -= 1;
    // Las alas de aviones pueden apoyarse entre si, pero no formar un grupo aparte lejos del nucleo.
    if (PLANES.has(type) && nearestCore !== Infinity) s -= 0.35 * Math.max(0, nearestCore - LINK_RADIUS);
  }

  if (type !== 'Minador') {
    const kind = getCellKind(r, c);
    if (kind === 'workshop' || kind === 'bay') s -= 0.5;
  }

  if (PLANES.has(type)) {
    s += laneScore(l, r, c);
  }
  for (const q of l.placed) {
    if (PLANES.has(q.type) && q.c === c && (r - q.r) * l.fwd > 0) s -= 2.2;
  }

  // Un barco propio justo delante tapa la linea de tiro de acorazados y cruceros.
  if (GUNSHIPS.has(type)) {
    if (l.placed.some(q => q.c === c && (q.r - r) * l.fwd > 0 && (q.r - r) * l.fwd <= 2)) s -= 0.7;
  } else {
    if (l.placed.some(q => GUNSHIPS.has(q.type) && q.c === c && (r - q.r) * l.fwd > 0 && (r - q.r) * l.fwd <= 3)) s -= 0.7;
  }

  if (type === 'Submarino') {
    let best = 0;
    for (const q of l.placed) {
      if (q.type !== 'Fragata' || l.paired.has(q.id)) continue;
      const d = Math.abs(q.r - r) + Math.abs(q.c - c);
      const shield = q.c === c && q.r - r === l.fwd;
      const v = shield ? 1.2 : d === 1 ? 0.9 : d === 2 ? 0.4 : 0;
      if (v > best) best = v;
    }
    s += best;
  }

  if (type === 'Minador') {
    if (mode === 'flank') {
      s += 0.9 - 0.3 * Math.abs(Math.abs(c - l.center) - 5);
    } else {
      let nearest = Infinity;
      for (const w of l.workshops) nearest = Math.min(nearest, manhattan({ r, c }, w));
      s += Math.max(1.2 - 0.3 * nearest, -1.5);
    }
  }

  return s;
}

function place(l: Layout, piece: ViewPiece, r: number, c: number): void {
  const type = piece.type as UnitType;
  if (type === 'Submarino') {
    let best: Placed | null = null;
    let bestV = 0;
    for (const q of l.placed) {
      if (q.type !== 'Fragata' || l.paired.has(q.id)) continue;
      const d = Math.abs(q.r - r) + Math.abs(q.c - c);
      const v = q.c === c && q.r - r === l.fwd ? 3 : d === 1 ? 2 : d === 2 ? 1 : 0;
      if (v > bestV) {
        bestV = v;
        best = q;
      }
    }
    if (best) l.paired.add(best.id);
  }
  l.placed.push({ id: piece.id, type, r, c });
}

interface Step {
  piece: ViewPiece;
  mode: MinadorMode | null;
}

/** Orden de colocacion por oleadas: frente, escoltas emparejadas, alas de aviones y minadores al fondo. */
function buildSequence(own: readonly ViewPiece[]): Step[] {
  const of = (t: UnitType) => own.filter(p => p.type === t);
  const steps: Step[] = [];
  const add = (ps: ViewPiece[], mode: MinadorMode | null = null) => ps.forEach(piece => steps.push({ piece, mode }));

  add(of('Acorazado'));
  add(of('Crucero'));

  const fragatas = of('Fragata');
  const subs = of('Submarino');
  while (fragatas.length > 0 || subs.length > 0) {
    const f = fragatas.shift();
    const s = subs.shift();
    if (f) steps.push({ piece: f, mode: null });
    if (s) steps.push({ piece: s, mode: null });
  }

  const combat = of('AvionCombate');
  const recon = of('AvionReconocimiento');
  // Alternar combate y reconocimiento reparte las alas a los dos lados de la formacion.
  while (combat.length > 0 || recon.length > 0) {
    const a = combat.shift();
    const b = recon.shift();
    if (a) steps.push({ piece: a, mode: null });
    if (b) steps.push({ piece: b, mode: null });
  }

  of('Minador').forEach((piece, i) => steps.push({ piece, mode: i % 3 === 2 ? 'flank' : 'dock' }));

  const known = new Set(steps.map(s => s.piece.id));
  const rest = own.filter(p => !known.has(p.id));
  for (const piece of rest) steps.push({ piece, mode: null });
  return steps;
}

function near(a: { r: number; c: number }, b: { r: number; c: number }): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) <= LINK_RADIUS;
}

/** Ids de las piezas unidas (cadena de piezas a distancia <= LINK_RADIUS) a la primera pieza colocada. */
function mainGroup(l: Layout): Set<string> {
  const group = new Set<string>();
  if (l.placed.length === 0) return group;
  const queue = [l.placed[0]];
  group.add(l.placed[0].id);
  for (let head = 0; head < queue.length; head++) {
    for (const q of l.placed) {
      if (!group.has(q.id) && near(queue[head], q)) {
        group.add(q.id);
        queue.push(q);
      }
    }
  }
  return group;
}

/** Reubica las piezas que quedaron sueltas o en islotes aparte, pegadas al grupo principal. */
function repairConnectivity(l: Layout, own: readonly ViewPiece[], cells: readonly Cell[], modes: Map<string, MinadorMode | null>): void {
  for (let pass = 0; pass < 3; pass++) {
    const main = mainGroup(l);
    const loose = l.placed.filter(p => !main.has(p.id));
    if (loose.length === 0) return;
    for (const p of loose) {
      const idx = l.placed.indexOf(p);
      l.placed.splice(idx, 1);
      const taken = new Set(l.placed.map(q => cellIdx(q.r, q.c)));
      const anchors = l.placed.filter(q => main.has(q.id));
      const piece = own.find(o => o.id === p.id) as ViewPiece;
      let best: Cell | null = null;
      let bestScore = -Infinity;
      for (const cell of cells) {
        if (taken.has(cellIdx(cell.r, cell.c)) || !anchors.some(q => near(q, cell))) continue;
        const sc = scoreCell(l, piece, modes.get(p.id) ?? null, cell.r, cell.c);
        if (sc > bestScore) {
          bestScore = sc;
          best = cell;
        }
      }
      const target = best ?? { r: p.r, c: p.c };
      l.placed.splice(idx, 0, { id: p.id, type: p.type, r: target.r, c: target.c });
      if (best) main.add(p.id);
    }
  }
}

/**
 * Despliegue de las 16 piezas de ctx.me en su franja, una celda distinta por pieza.
 * Nivel 1 es azar puro; los niveles altos arman una formacion: acorazado y cruceros al frente y al
 * centro, fragatas con su submarino detras, minadores junto al taller o en un flanco y aviones en
 * la retaguardia con la columna libre hasta el rival. Determinista dado ctx.rng.
 */
export function planSetup(ctx: SetupContext): Placement[] {
  const { me, level, rng } = ctx;
  const own = ctx.view.pieces.filter(p => p.owner === me);
  const cells = getSetupCells(me);
  const criteria = CRITERIA[level];
  const jitter = JITTER[level];
  const player = me;

  const enemy = new Set<number>();
  for (const p of ctx.view.pieces) if (p.owner !== me && p.pos) enemy.add(cellIdx(p.pos.r, p.pos.c));

  const layout: Layout = {
    player,
    fwd: player === 'A' ? 1 : -1,
    center: (1 + BOARD_COLS) / 2 + (rng() * 4 - 2),
    enemyFrontRow: player === 'A' ? STRIPS.B.rows[0] : STRIPS.A.rows[1],
    workshops: boardConfig.zoneDock[player].workshops,
    placed: [],
    enemy,
    paired: new Set(),
  };

  const taken = new Set<number>();
  const modes = new Map<string, MinadorMode | null>();
  const result = new Map<string, Cell>();

  for (const { piece, mode } of buildSequence(own)) {
    modes.set(piece.id, mode);
    const free = cells.filter(cell => !taken.has(cellIdx(cell.r, cell.c)));
    let chosen: Cell;
    if (rng() >= criteria) {
      chosen = pick(free, rng);
    } else {
      chosen = free[0];
      let best = -Infinity;
      for (const cell of free) {
        const sc = scoreCell(layout, piece, mode, cell.r, cell.c) + (rng() * 2 - 1) * jitter;
        if (sc > best) {
          best = sc;
          chosen = cell;
        }
      }
    }
    taken.add(cellIdx(chosen.r, chosen.c));
    result.set(piece.id, chosen);
    place(layout, piece, chosen.r, chosen.c);
  }

  if (level >= REPAIR_FROM_LEVEL) {
    repairConnectivity(layout, own, cells, modes);
    for (const p of layout.placed) result.set(p.id, { r: p.r, c: p.c });
  }

  return own.map(p => ({ pieceId: p.id, pos: result.get(p.id) as Cell }));
}
