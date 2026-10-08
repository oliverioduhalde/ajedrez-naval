/**
 * API pública del motor de audio: sonidos sintetizados con Web Audio (sin archivos). Cada sonido entra
 * con fade in y sale con fade out; los de largo variable reparten sus fades dentro de `dur`.
 */
import { playSound, renderSoundOffline, setAudioEnabled, setMasterVolume, unlockAudio } from './engine';
import type { SoundInfo } from './types';
import { SOUND_IDS, VOICES } from './voices';

export type { PlayOpts, SoundInfo } from './types';

export const SOUND_LIST: SoundInfo[] = SOUND_IDS.map(id => ({
  id,
  label: VOICES[id].label,
  blurb: VOICES[id].blurb,
  defaultDur: VOICES[id].defaultDur,
}));

export { playSound, unlockAudio, setAudioEnabled, setMasterVolume, renderSoundOffline };
