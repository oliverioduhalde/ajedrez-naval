import type { SoundId } from '../types';

export interface PlayOpts {
  /** segundos desde ahora hasta que arranca el sonido */
  delay?: number;
  /** segundos de duración total para sonidos de largo variable */
  dur?: number;
  /** volumen relativo (1 = nominal) */
  gain?: number;
}

export interface SoundInfo {
  id: SoundId;
  label: string;
  blurb: string;
  /** duración por defecto en segundos, para el botón de prueba */
  defaultDur: number;
}
