import React from 'react';
import type { FxSpec } from '../../fx/types';
import type { Rot } from '../boardRotation';
import { anim } from './geometry';

export interface FxProps<T extends FxSpec['type']> {
  spec: Extract<FxSpec, { type: T }>;
  /** semilla estable (id del efecto) para los valores "aleatorios" deterministas */
  seed: number;
  /** animation-delay en ms; negativo si el efecto ya empezó */
  delay: number;
  cs: number;
  rot: Rot;
}

/** Anillo de onda con trazo de grosor constante aunque se escale (círculo si w === h). */
export const Ring: React.FC<{
  w: number; h: number; delay: number; dur: number; color: string; fill?: string; stroke?: number;
}> = ({ w, h, delay, dur, color, fill = 'none', stroke = 2 }) => (
  <svg
    width={w} height={h} viewBox={`0 0 ${w} ${h}`}
    style={{ position: 'absolute', left: -w / 2, top: -h / 2, overflow: 'visible' }}
  >
    <ellipse
      cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2}
      fill={fill} stroke={color} strokeWidth={stroke} vectorEffect="non-scaling-stroke"
      style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: anim('fx-ring-grow', dur, delay) }}
    />
  </svg>
);

/** Origen de un efecto: caja de tamaño 0 en (x, y). `isolate` encierra la mezcla de capas (screen) dentro del efecto. */
export const Anchor: React.FC<{ x: number; y: number; isolate?: boolean; children: React.ReactNode }> = ({ x, y, isolate, children }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, isolation: isolate ? 'isolate' : undefined }}>{children}</div>
);
