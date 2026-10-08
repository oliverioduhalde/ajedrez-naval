import type { FactionId } from '../../config/factions';

/** [altura, pulsos]: la altura es un nombre como "C4" o "F#4"; "rest" es un silencio. */
export type AnthemNote = [pitch: string, beats: number];

export interface AnthemData {
  bpm: number;
  notes: AnthemNote[];
}

const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Frecuencia en Hz de un nombre de nota ("C4", "F#4", "Bb3"); null para silencios o nombres inválidos. */
export function noteFreq(pitch: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(pitch);
  if (!m) return null;
  const semis = SEMITONE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semis - 69) / 12);
}

/**
 * La parte más famosa del himno de cada facción, transcripta de partituras abiertas y contrastada
 * con una segunda fuente por un verificador independiente. Solo melodía (una voz).
 * Alemania: melodía de Haydn (primera estrofa del Deutschlandlied); no incluye el Horst-Wessel-Lied.
 */
export const ANTHEMS: Record<FactionId, AnthemData> = {
  // URSS (Unión Soviética) · confianza alta · 12.63 s · Do mayor (C major), tal como figura en la transcripción de C
  urss: { bpm: 76, notes: [['G4', 0.5], ['C5', 1], ['G4', 0.75], ['A4', 0.25], ['B4', 1], ['E4', 0.5], ['E4', 0.5], ['A4', 1], ['G4', 0.75], ['F4', 0.25], ['G4', 1], ['C4', 0.75], ['C4', 0.25], ['D4', 1], ['D4', 0.75], ['E4', 0.25], ['F4', 1], ['F4', 0.5], ['G4', 0.5], ['A4', 1], ['B4', 0.75], ['C5', 0.25], ['D5', 1.5]] },
  // Italia · confianza alta · 13.88 s · Si bemol mayor (Bb major), tonalidad original, sin transport
  italia: { bpm: 134, notes: [['F4', 1], ['F4', 0.75], ['G4', 0.25], ['F4', 1], ['rest', 1], ['D5', 1], ['D5', 0.75], ['Eb5', 0.25], ['D5', 1], ['rest', 1], ['D5', 1], ['F5', 0.75], ['Eb5', 0.25], ['D5', 2], ['C5', 1], ['D5', 0.75], ['C5', 0.25], ['Bb4', 1], ['rest', 1], ['F4', 1], ['F4', 0.75], ['G4', 0.25], ['F4', 1], ['rest', 1], ['D5', 1], ['D5', 0.75], ['Eb5', 0.25], ['D5', 1], ['rest', 1], ['D5', 1], ['F5', 0.75], ['Eb5', 0.25], ['D5', 2], ['C5', 1], ['D5', 0.75], ['C5', 0.25], ['Bb4', 1]] },
  // Alemania (Tercer Reich, 1933-1945) · confianza alta · 12.63 s · Sol mayor (G major), transportada una tercera mayor hacia ar
  alemania: { bpm: 76, notes: [['G4', 1.5], ['A4', 0.5], ['B4', 1], ['A4', 1], ['C5', 1], ['B4', 1], ['A4', 0.5], ['F#4', 0.5], ['G4', 1], ['E5', 1], ['D5', 1], ['C5', 1], ['B4', 1], ['A4', 1], ['B4', 0.5], ['G4', 0.5], ['D5', 2]] },
  // Reino Unido · confianza alta · 12.86 s · Sol mayor (G major), sin transportar
  uk: { bpm: 84, notes: [['G4', 1], ['G4', 1], ['A4', 1], ['F#4', 1.5], ['G4', 0.5], ['A4', 1], ['B4', 1], ['B4', 1], ['C5', 1], ['B4', 1.5], ['A4', 0.5], ['G4', 1], ['A4', 1], ['G4', 1], ['F#4', 1], ['G4', 3]] },
  // Estados Unidos · confianza alta · 13.85 s · Do mayor (C major), transportada +2 semitonos desde la tonal
  usa: { bpm: 104, notes: [['G4', 0.75], ['E4', 0.25], ['C4', 1], ['E4', 1], ['G4', 1], ['C5', 2], ['E5', 0.75], ['D5', 0.25], ['C5', 1], ['E4', 1], ['F#4', 1], ['G4', 2], ['G4', 0.5], ['G4', 0.5], ['E5', 1.5], ['D5', 0.5], ['C5', 1], ['B4', 2], ['A4', 0.75], ['B4', 0.25], ['C5', 1], ['C5', 1], ['G4', 1], ['E4', 1], ['C4', 1]] },
  // Japón · confianza alta · 13.71 s · Re dórico (re mi sol la si do, sin alteraciones; la partitur
  japon: { bpm: 70, notes: [['D4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['G4', 1], ['E4', 1], ['D4', 2], ['E4', 1], ['G4', 1], ['A4', 1], ['G4', 0.5], ['A4', 0.5], ['D5', 1], ['B4', 1], ['A4', 1], ['G4', 1]] },
};
