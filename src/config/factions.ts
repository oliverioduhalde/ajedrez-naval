import type { PaletteId, Tones } from '../ui/theme';

/**
 * Facciones de la partida (Segunda Guerra Mundial). Cada una define el color de sus fichas, su
 * bandera para el menú de elección y el himno que suena cuando gana (ver `src/fx/anthems`).
 */
export type FactionId = 'urss' | 'alemania' | 'italia' | 'uk' | 'usa' | 'japon';

export interface FactionDef {
  id: FactionId;
  name: string;
  /** Aclaración corta que se muestra debajo del nombre. */
  era: string;
  /** Nombre del himno que suena al ganar. */
  anthem: string;
  /** Paleta de la interfaz más cercana (solo para que el tablero nunca tenga el mismo color). */
  paletteId: PaletteId;
  /** Tonos de la interfaz (texto, bordes y fondos) para el bando que juega con esta facción. */
  tones: Tones;
  /** Color de los íconos de las fichas. */
  glyph: string;
  /** Color del borde de las fichas sin seleccionar. */
  edge: string;
  /** Bandera sin transparencias, para los selectores. */
  flag: string;
  /** Fondo de la ficha: `strength` 1 es el normal, 2 es el de la ficha seleccionada. */
  token: (strength: 1 | 2) => string;
  /** Las fichas llevan una sombra oscura detrás del ícono para leerse sobre bandas claras. */
  shadowGlyph: boolean;
}

const gray = (l: number) => `hsl(0 0% ${l}%)`;

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

const vertical = (colors: string[], a: number) => {
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `${rgba(c, a)} ${i * step}% ${(i + 1) * step}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
};

const TONES = (main: string, soft: string, mute: string, line: string, faint: string, rgb: string): Tones => ({ main, soft, mute, line, faint, rgb });

const RED = '#d8283c';
const GREEN = '#009246';
const WHITE = '#f1f1ee';
const NAVY = '#1c3f9c';
const BLUE = '#2f64d6';
const JP_RED = '#e60012';

export const FACTIONS: FactionDef[] = [
  {
    id: 'urss', name: 'URSS', era: 'Unión Soviética', anthem: 'Himno de la Unión Soviética', paletteId: 'rojo',
    tones: TONES('hsl(355 85% 56%)', 'hsl(355 64% 44%)', 'hsl(355 43% 33%)', 'hsl(355 43% 21%)', 'hsl(355 38% 11%)', '236, 51, 66'),
    glyph: 'hsl(355 85% 62%)', edge: 'hsl(355 70% 48%)',
    flag: 'radial-gradient(circle at 24% 30%, #ffd23c 0 7%, transparent 8%), #cc0000',
    token: s => rgba('#cc0000', s === 2 ? 0.55 : 0.34),
    shadowGlyph: false,
  },
  {
    id: 'alemania', name: 'Alemania', era: 'Tercer Reich', anthem: 'Das Lied der Deutschen', paletteId: 'blanco',
    tones: TONES(gray(68), gray(52), gray(40), gray(25), gray(12), '173, 173, 173'),
    glyph: gray(74), edge: gray(62),
    flag: '#080808',
    token: s => (s === 2 ? '#1b1b1b' : '#050505'),
    shadowGlyph: false,
  },
  {
    id: 'italia', name: 'Italia', era: 'Reino de Italia', anthem: 'Il Canto degli Italiani', paletteId: 'verde',
    tones: TONES('hsl(145 66% 50%)', 'hsl(145 50% 40%)', 'hsl(145 33% 31%)', 'hsl(145 33% 20%)', 'hsl(145 30% 10%)', '43, 211, 117'),
    glyph: '#f6f6f2', edge: gray(72),
    flag: `linear-gradient(90deg, ${GREEN} 0 33.3%, ${WHITE} 33.3% 66.6%, ${RED} 66.6% 100%)`,
    token: s => vertical([GREEN, WHITE, RED], s === 2 ? 0.62 : 0.4),
    shadowGlyph: true,
  },
  {
    id: 'uk', name: 'Reino Unido', era: 'Gran Bretaña', anthem: 'God Save the King', paletteId: 'blanco',
    tones: TONES(gray(90), gray(70), gray(48), gray(28), gray(14), '230, 230, 230'),
    glyph: '#f6f6f2', edge: gray(78),
    flag: `linear-gradient(90deg, ${RED} 0 33.3%, ${WHITE} 33.3% 66.6%, ${NAVY} 66.6% 100%)`,
    token: s => vertical([RED, WHITE, NAVY], s === 2 ? 0.62 : 0.4),
    shadowGlyph: true,
  },
  {
    id: 'usa', name: 'Estados Unidos', era: 'EE. UU.', anthem: 'The Star-Spangled Banner', paletteId: 'azul',
    tones: TONES('hsl(214 90% 56%)', 'hsl(214 68% 44%)', 'hsl(214 45% 33%)', 'hsl(214 45% 21%)', 'hsl(214 40% 11%)', '38, 127, 238'),
    glyph: '#f6f6f2', edge: 'hsl(214 60% 60%)',
    flag: `linear-gradient(135deg, ${NAVY} 0 50%, ${RED} 50% 100%)`,
    token: s => `linear-gradient(135deg, ${rgba(BLUE, s === 2 ? 0.7 : 0.46)} 0 50%, ${rgba(RED, s === 2 ? 0.7 : 0.46)} 50% 100%)`,
    shadowGlyph: true,
  },
  {
    id: 'japon', name: 'Japón', era: 'Imperio del Japón', anthem: 'Kimigayo', paletteId: 'blanco',
    tones: TONES(gray(88), gray(68), gray(46), gray(27), gray(13), '224, 224, 224'),
    glyph: '#f6f6f2', edge: gray(76),
    flag: `radial-gradient(circle at 50% 50%, ${JP_RED} 0 30%, transparent 31%), ${WHITE}`,
    token: s => `radial-gradient(circle at 50% 50%, ${rgba(JP_RED, s === 2 ? 0.85 : 0.62)} 0 36%, ${rgba(WHITE, s === 2 ? 0.34 : 0.2)} 37%)`,
    shadowGlyph: true,
  },
];

export const FACTION_IDS = FACTIONS.map(f => f.id);

export const factionOf = (id: FactionId): FactionDef => FACTIONS.find(f => f.id === id) ?? FACTIONS[0];

export const isFactionId = (v: unknown): v is FactionId => FACTION_IDS.includes(v as FactionId);

/** Primera facción libre después de `taken` (para que los dos bandos nunca jueguen con la misma). */
export function otherFaction(taken: FactionId, prefer?: FactionId): FactionId {
  if (prefer && prefer !== taken) return prefer;
  return FACTION_IDS.find(id => id !== taken) ?? taken;
}
