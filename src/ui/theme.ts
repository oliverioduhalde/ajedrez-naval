import { useMemo } from 'react';
import { useSettings } from '../store/settingsStore';

export type PaletteId = 'verde' | 'ambar' | 'cian' | 'azul' | 'violeta' | 'rojo' | 'blanco';

export interface PaletteDef {
  id: PaletteId;
  name: string;
  hue: number;
  sat: number;
}

export interface Tones {
  main: string;
  soft: string;
  mute: string;
  line: string;
  faint: string;
  rgb: string;
}

export const PALETTES: PaletteDef[] = [
  { id: 'verde',   name: 'Verde',   hue: 145, sat: 80 },
  { id: 'ambar',   name: 'Ámbar',   hue: 38,  sat: 100 },
  { id: 'cian',    name: 'Cian',    hue: 188, sat: 85 },
  { id: 'azul',    name: 'Azul',    hue: 214, sat: 90 },
  { id: 'violeta', name: 'Violeta', hue: 272, sat: 80 },
  { id: 'rojo',    name: 'Rojo',    hue: 355, sat: 85 },
  { id: 'blanco',  name: 'Blanco',  hue: 150, sat: 0 },
];

export const AUTO_RIVAL: Record<PaletteId, PaletteId> = {
  verde: 'ambar',
  ambar: 'cian',
  cian: 'ambar',
  azul: 'ambar',
  violeta: 'verde',
  rojo: 'cian',
  blanco: 'ambar',
};

export function resolveRival(main: PaletteId, rival: PaletteId | 'auto'): PaletteId {
  const r = rival === 'auto' ? AUTO_RIVAL[main] : rival;
  return r === main ? AUTO_RIVAL[main] : r;
}

const def = (id: PaletteId) => PALETTES.find(p => p.id === id)!;

function hsl(p: PaletteDef, satK: number, light: number): string {
  return `hsl(${p.hue} ${Math.round(p.sat * satK)}% ${light}%)`;
}

function rgbOf(p: PaletteDef, light: number): string {
  const s = p.sat / 100;
  const l = light / 100;
  const k = (n: number) => (n + p.hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255)).join(', ');
}

export function tonesOf(id: PaletteId): Tones {
  const p = def(id);
  const neutral = p.sat === 0;
  return {
    main: hsl(p, 1, neutral ? 90 : 56),
    soft: hsl(p, 0.75, neutral ? 70 : 44),
    mute: hsl(p, 0.5, neutral ? 48 : 33),
    line: hsl(p, 0.5, neutral ? 28 : 21),
    faint: hsl(p, 0.45, neutral ? 14 : 11),
    rgb: rgbOf(p, neutral ? 90 : 56),
  };
}

export function paletteSwatch(id: PaletteId): string {
  return tonesOf(id).main;
}

export function useSideTones(): { A: Tones; B: Tones } {
  const main = useSettings(s => s.colorMain);
  const rival = useSettings(s => s.colorRival);
  return useMemo(() => ({ A: tonesOf(main), B: tonesOf(resolveRival(main, rival)) }), [main, rival]);
}

function setSide(root: CSSStyleDeclaration, prefix: string, t: Tones) {
  root.setProperty(`--${prefix}`, t.main);
  root.setProperty(`--${prefix}-soft`, t.soft);
  root.setProperty(`--${prefix}-mute`, t.mute);
  root.setProperty(`--${prefix}-line`, t.line);
  root.setProperty(`--${prefix}-faint`, t.faint);
  root.setProperty(`--${prefix}-rgb`, t.rgb);
}

export function applyTheme(main: PaletteId, rival: PaletteId | 'auto') {
  const root = document.documentElement.style;
  const m = def(main);
  setSide(root, 'main', tonesOf(main));
  setSide(root, 'rv', tonesOf(resolveRival(main, rival)));
  root.setProperty('--bg', hsl(m, 0.35, 3.5));
  root.setProperty('--panel', hsl(m, 0.4, 6.5));
  root.setProperty('--panel-2', hsl(m, 0.4, 9.5));
  root.setProperty('--line', hsl(m, 0.45, 17));
  root.setProperty('--text', hsl(m, 0.3, 82));
  root.setProperty('--danger', '#ff5a5a');
  root.setProperty('--warn', '#ffb020');
}

export function initTheme() {
  const sync = () => {
    const s = useSettings.getState();
    applyTheme(s.colorMain, s.colorRival);
  };
  sync();
  let last = '';
  useSettings.subscribe(s => {
    const key = s.colorMain + '|' + s.colorRival;
    if (key !== last) {
      last = key;
      sync();
    }
  });
}
