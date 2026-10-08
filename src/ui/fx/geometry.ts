import type { CSSProperties } from 'react';
import { boardConfig } from '../../config/boardConfig';
import type { Cell } from '../../fx/types';
import { mapCell, type Rot } from '../boardRotation';

const COLS = boardConfig.cols;
const ROWS = boardConfig.rows;

export interface Point { x: number; y: number }

/** Centro de una celda del motor en px de pantalla (la vista puede estar rotada). */
export function cellCenter(rot: Rot, cell: Cell, cellSize: number): Point {
  const { row, col } = mapCell(rot, cell.r, cell.c, COLS, ROWS);
  return { x: (col - 0.5) * cellSize, y: (row - 0.5) * cellSize };
}

/** Esquina superior izquierda de una celda del motor en px de pantalla. */
export function cellOrigin(rot: Rot, cell: Cell, cellSize: number): Point {
  const { row, col } = mapCell(rot, cell.r, cell.c, COLS, ROWS);
  return { x: (col - 1) * cellSize, y: (row - 1) * cellSize };
}

/** Eje de un disparo en pantalla: origen, ángulo (grados, 0 = hacia la derecha) y largo en px. */
export function axis(rot: Rot, from: Cell, to: Cell, cellSize: number) {
  const a = cellCenter(rot, from, cellSize);
  const b = cellCenter(rot, to, cellSize);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { origin: a, angle: (Math.atan2(dy, dx) * 180) / Math.PI, length: Math.hypot(dx, dy) };
}

/** Número pseudoaleatorio estable en [0, 1): mismo (seed, i, salt) da siempre lo mismo. */
export function rnd(seed: number, i: number, salt = 0): number {
  const s = Math.sin(seed * 127.1 + i * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Semilla estable a partir de un texto (para desfasar los parpadeos de cada barco). */
export function hashString(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 9973;
  return h + 1;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Variables CSS tipadas (px como número, el resto tal cual). */
export function cssVars(vars: Record<string, string | number>): CSSProperties {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) out[k] = typeof v === 'number' ? `${Math.round(v * 100) / 100}px` : v;
  return out as CSSProperties;
}

interface AnimOpts { ease?: string; count?: number | 'infinite'; fill?: string }

/** Shorthand de animación. `delay` puede ser negativo (la animación ya empezó). */
export function anim(name: string, dur: number, delay: number, opts: AnimOpts = {}): string {
  const { ease = 'ease-out', count = 1, fill = 'both' } = opts;
  return `${name} ${Math.round(dur)}ms ${ease} ${Math.round(delay)}ms ${count} ${fill}`;
}

/** Caja centrada en el origen del contenedor (que tiene tamaño 0). */
export function centered(w: number, h: number = w): CSSProperties {
  return { position: 'absolute', left: -w / 2, top: -h / 2, width: w, height: h };
}
