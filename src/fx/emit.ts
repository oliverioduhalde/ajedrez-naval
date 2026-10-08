import { useSettings } from '../store/settingsStore';
import { planEvent } from './choreography';
import { useFxStore } from './fxStore';
import { playSound, setAudioEnabled, setMasterVolume } from './audio';
import type { FxEvent } from './types';

let wired = false;

/** Sincroniza el motor de audio con los ajustes (una sola vez). */
function wireSettings() {
  if (wired) return;
  wired = true;
  const apply = () => {
    const s = useSettings.getState();
    setAudioEnabled(s.soundOn);
    setMasterVolume(s.soundVolume);
  };
  apply();
  useSettings.subscribe(apply);
}

/** Punto de entrada: el store de la partida llama a esto tras cada acción válida. */
export function emitFx(ev: FxEvent): void {
  wireSettings();
  const { soundOn, fxOn } = useSettings.getState();
  const plan = planEvent(ev);
  if (soundOn) {
    for (const s of plan.sounds) {
      playSound(s.id, {
        delay: s.at / 1000,
        dur: s.dur !== undefined ? s.dur / 1000 : undefined,
        gain: s.gain,
      });
    }
  }
  if (fxOn) useFxStore.getState().add(plan.visuals, plan.total);
}

// Solo en desarrollo: para disparar efectos a mano desde la consola del navegador.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__fx = { emitFx, useFxStore, playSound };
}
