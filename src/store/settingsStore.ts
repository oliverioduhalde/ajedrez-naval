import { create } from 'zustand';
import type { CpuLevel } from '../ai/types';
import type { Rot } from '../ui/boardRotation';
import type { PaletteId } from '../ui/theme';
import { isFactionId, otherFaction, type FactionId } from '../config/factions';

export const CPU_AVAILABLE = true;

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
  /** Tercer color: el del tablero (mar, islas, grilla, radar). Nunca coincide con el de las fichas. */
  colorBoard: PaletteId;
  /** Facción de cada bando: define el color de sus fichas y el himno que suena al ganar. */
  factionA: FactionId;
  factionB: FactionId;
  railCollapsed: boolean;
  pieceZoomOn: boolean;
  pieceZoomSize: number;
  showRanges: boolean;
  vsCpu: boolean;
  cpuLevel: CpuLevel;
  /** Sonidos de la partida (sintetizados). */
  soundOn: boolean;
  soundVolume: number;
  /** Animaciones de disparos, explosiones y llamas. */
  fxOn: boolean;
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
}

export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 4;

const KEY = 'ajedrez-naval-settings-v2';
const PALETTE_IDS = ['verde', 'ambar', 'cian', 'azul', 'violeta', 'rojo', 'blanco', 'mar'];

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
  colorBoard: 'mar',
  factionA: 'usa',
  factionB: 'japon',
  railCollapsed: false,
  pieceZoomOn: true,
  pieceZoomSize: 300,
  showRanges: true,
  vsCpu: false,
  cpuLevel: 2,
  soundOn: true,
  soundVolume: 0.8,
  fxOn: true,
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
    if (!PALETTE_IDS.includes(merged.colorBoard)) merged.colorBoard = 'mar';
    if (!isFactionId(merged.factionA)) merged.factionA = DEFAULTS.factionA;
    if (!isFactionId(merged.factionB)) merged.factionB = DEFAULTS.factionB;
    if (merged.factionB === merged.factionA) merged.factionB = otherFaction(merged.factionA);
    merged.soundVolume = clamp(Number(p.soundVolume ?? 0.8), 0, 1);
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
