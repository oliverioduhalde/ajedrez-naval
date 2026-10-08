import { create } from 'zustand';
import type { CpuLevel } from '../ai/types';
import type { Rot } from '../ui/boardRotation';
import type { PaletteId } from '../ui/theme';

export const CPU_AVAILABLE = false;

export interface Settings {
  radarOn: boolean;
  radarSpeed: number;
  radarIntensity: number;
  crtOn: boolean;
  glitchOn: boolean;
  glitchRate: number;
  flickerOn: boolean;
  zoom: number;
  rotation: 'auto' | Rot;
  colorMain: PaletteId;
  colorRival: PaletteId | 'auto';
  railCollapsed: boolean;
  pieceZoomOn: boolean;
  pieceZoomSize: number;
  showRanges: boolean;
  vsCpu: boolean;
  cpuLevel: CpuLevel;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
}

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 4;

const KEY = 'ajedrez-naval-settings-v2';
const PALETTE_IDS = ['verde', 'ambar', 'cian', 'azul', 'violeta', 'rojo', 'blanco'];

const DEFAULTS: Settings = {
  radarOn: true,
  radarSpeed: 1,
  radarIntensity: 1,
  crtOn: false,
  glitchOn: false,
  glitchRate: 1,
  flickerOn: false,
  zoom: 1,
  rotation: 'auto',
  colorMain: 'verde',
  colorRival: 'auto',
  railCollapsed: false,
  pieceZoomOn: true,
  pieceZoomSize: 300,
  showRanges: true,
  vsCpu: false,
  cpuLevel: 2,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...DEFAULTS, ...p };
    merged.zoom = clamp(Number(p.zoom ?? 1), ZOOM_MIN, ZOOM_MAX);
    merged.pieceZoomSize = clamp(Number(p.pieceZoomSize ?? 300), 160, 560);
    if (![0, 90, 180, 270].includes(merged.rotation as number)) merged.rotation = 'auto';
    if (!PALETTE_IDS.includes(merged.colorMain)) merged.colorMain = 'verde';
    if (merged.colorRival !== 'auto' && !PALETTE_IDS.includes(merged.colorRival)) merged.colorRival = 'auto';
    if (!CPU_AVAILABLE) merged.vsCpu = false;
    return merged;
  } catch {
    return DEFAULTS;
  }
}

const KEYS = Object.keys(DEFAULTS) as (keyof Settings)[];

function save(s: Settings) {
  try {
    const out: Record<string, unknown> = {};
    for (const k of KEYS) out[k] = s[k];
    localStorage.setItem(KEY, JSON.stringify(out));
  } catch {
    // storage blocked: settings just won't persist
  }
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  set(patch) {
    set(patch);
    save(get());
  },
  zoomBy(factor) {
    set({ zoom: clamp(get().zoom * factor, ZOOM_MIN, ZOOM_MAX) });
    save(get());
  },
  resetZoom() {
    set({ zoom: 1 });
    save(get());
  },
}));
