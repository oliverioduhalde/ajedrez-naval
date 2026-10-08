import { create } from 'zustand';
import type { FxSpec } from './types';

/** Un efecto visual en curso. `t0` es performance.now() del momento en que arrancó la acción. */
export interface ActiveFx {
  id: number;
  t0: number;
  spec: FxSpec;
}

interface FxStore {
  effects: ActiveFx[];
  /** Agrega los efectos de una acción; se retiran solos pasados `total` ms (+ margen). */
  add: (specs: FxSpec[], total: number) => void;
  clear: () => void;
}

let nextId = 1;
const MARGIN_MS = 250;

export const useFxStore = create<FxStore>((set) => ({
  effects: [],
  add(specs, total) {
    if (specs.length === 0) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const added: ActiveFx[] = specs.map(spec => ({ id: nextId++, t0, spec }));
    const ids = new Set(added.map(a => a.id));
    set(s => ({ effects: [...s.effects, ...added] }));
    setTimeout(() => {
      set(s => ({ effects: s.effects.filter(e => !ids.has(e.id)) }));
    }, total + MARGIN_MS);
  },
  clear() {
    set({ effects: [] });
  },
}));

/**
 * Retardo CSS (ms) para animar un efecto: negativo si ya pasó parte de su espera,
 * así un remontaje de la capa (rotar el tablero, zoom) continúa donde iba.
 */
export function fxDelayMs(fx: ActiveFx, now: number = performance.now()): number {
  return fx.spec.at - (now - fx.t0);
}
