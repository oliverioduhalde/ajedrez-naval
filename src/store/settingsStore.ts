import { create } from 'zustand';
import type { CpuLevel } from '../ai/types';
import type { Rot } from '../ui/boardRotation';

export interface Settings {
  radarOn: boolean;
  radarSpeed: number;
  radarIntensity: number;
  glitchOn: boolean;
  glitchRate: number;
  flickerOn: boolean;
  zoom: number;
  rotation: 'auto' | Rot;
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

const KEY = 'ajedrez-naval-settings-v1';

const DEFAULTS: Settings = {
  radarOn: true,
  radarSpeed: 1,
  radarIntensity: 1,
  glitchOn: false,
  glitchRate: 1,
  flickerOn: false,
  zoom: 1,
  rotation: 'auto',
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
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const rotation = [0, 90, 180, 270].includes(parsed.rotation as number) ? parsed.rotation : 'auto';
    return { ...DEFAULTS, ...parsed, rotation: rotation as Settings['rotation'], zoom: clamp(parsed.zoom ?? 1, ZOOM_MIN, ZOOM_MAX) };
  } catch {
    return DEFAULTS;
  }
}

function save(s: Settings) {
  try {
    const { radarOn, radarSpeed, radarIntensity, glitchOn, glitchRate, flickerOn, zoom, rotation, vsCpu, cpuLevel } = s;
    localStorage.setItem(KEY, JSON.stringify({ radarOn, radarSpeed, radarIntensity, glitchOn, glitchRate, flickerOn, zoom, rotation, vsCpu, cpuLevel }));
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
