/**
 * Grafo de audio: cadena maestra (ganancia → compresor → limitador suave → salida), reverb por
 * convolución y programación de una voz. Sirve igual para AudioContext y OfflineAudioContext, de modo
 * que lo que se renderiza para verificar es exactamente lo que suena.
 */
import type { SoundId } from '../types';
import { shapeEnvelope } from './automation';
import { clamp, softClipCurve } from './dsp';
import { getAssets, Rack } from './rack';
import type { Assets } from './rack';
import type { PlayOpts } from './types';
import { VOICES } from './voices';

export interface Rig {
  ctx: BaseAudioContext;
  master: GainNode;
  convolver: ConvolverNode;
  assets: Assets;
}

export function createRig(ctx: BaseAudioContext, masterGain: number): Rig {
  const assets = getAssets(ctx);

  const master = ctx.createGain();
  master.gain.value = masterGain;

  // compresor suave para pegar las capas y un limitador tanh que nunca pasa de ~0,9
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  const limiter = ctx.createWaveShaper();
  limiter.curve = softClipCurve();
  limiter.oversample = '2x';

  const convolver = ctx.createConvolver();
  convolver.buffer = assets.ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.8;

  master.connect(comp);
  comp.connect(limiter);
  limiter.connect(ctx.destination);
  convolver.connect(wet);
  wet.connect(master);

  return { ctx, master, convolver, assets };
}

export interface VoiceHandle {
  id: SoundId;
  /** instante de arranque y de fin (s, reloj del contexto) */
  start: number;
  end: number;
  /** apaga la voz con un fade rápido y corta sus fuentes */
  kill: (now: number) => void;
  /** desconecta todos los nodos; se llama sola al terminar la voz */
  dispose: () => void;
  readonly disposed: boolean;
}

export function voiceDuration(id: SoundId, requested?: number): number {
  const def = VOICES[id];
  if (def.fixed !== undefined) return def.fixed;
  const d = requested !== undefined && Number.isFinite(requested) ? requested : def.defaultDur;
  return clamp(d, def.minDur, def.maxDur);
}

/** Margen tras el final de la voz para que el fade termine antes de cortar las fuentes. */
const END_PAD = 0.05;

export function scheduleVoice(
  rig: Rig, id: SoundId, t0: number, opts: PlayOpts, rng: () => number, onDone?: (h: VoiceHandle) => void,
): VoiceHandle {
  const def = VOICES[id];
  const dur = voiceDuration(id, opts.dur);
  const gain = clamp(opts.gain !== undefined && Number.isFinite(opts.gain) ? opts.gain : 1, 0, 2);
  const end = t0 + dur;

  const r = new Rack(rig.ctx, rig.assets, rng);
  r.limit = end + END_PAD;

  // bus (envolvente de la voz) → compuerta (para cortarla) → maestra y envío a la reverb
  const bus = r.gain(0);
  shapeEnvelope(bus.gain, t0, dur, def.fadeIn(dur), def.fadeOut(dur), def.level * gain);
  const gate = r.gain(1);
  bus.connect(gate);
  gate.connect(rig.master);
  if (def.wet > 0) r.chain(gate, r.gain(def.wet), rig.convolver);

  def.build({ r, out: bus, t: t0, dur, gain });

  // centinela mudo: su fin avisa que la voz terminó (sin setTimeout)
  const sentinel = r.osc('sine', 1, t0, end + END_PAD);
  r.chain(sentinel, r.gain(0), rig.master);

  let disposed = false;
  const handle: VoiceHandle = {
    id,
    start: t0,
    end,
    kill(now) {
      gate.gain.setTargetAtTime(0, now, 0.012);
      r.stopAll(now + 0.09);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sentinel.onended = null;
      r.dispose();
      onDone?.(handle);
    },
    get disposed() {
      return disposed;
    },
  };
  sentinel.onended = () => handle.dispose();
  return handle;
}
