/**
 * Grafo de audio: cadena maestra (ganancia → limitador suave → tope de seguridad → salida), reverb por
 * convolución y programación de una voz. Sirve igual para AudioContext y OfflineAudioContext, de modo
 * que lo que se renderiza para verificar es exactamente lo que suena.
 */
import type { SoundId } from '../types';
import { shapeEnvelope } from './automation';
import { clamp, hardLimitCurve, softClipCurve } from './dsp';
import { getAssets, Rack } from './rack';
import type { Assets } from './rack';
import type { PlayOpts } from './types';
import { VOICES } from './voices';

export interface Rig {
  ctx: BaseAudioContext;
  master: GainNode;
  convolver: ConvolverNode;
  /** último nodo de la cadena, antes de la salida (para medir lo que realmente suena) */
  output: AudioNode;
  assets: Assets;
}

export function createRig(ctx: BaseAudioContext, masterGain: number): Rig {
  const assets = getAssets(ctx);

  const master = ctx.createGain();
  master.gain.value = masterGain;

  // Limitador suave sin estado: lineal hasta ~0,55 y luego un tanh que no pasa de ~0,92 (admite picos de hasta ±2).
  // No se usa DynamicsCompressorNode: al arrancar tras un silencio atenúa ~3,6 dB y recupera en ~120 ms (aun con
  // ratio 1) y cambia de un navegador a otro, lo que ahoga los transitorios y haría que el render offline no
  // coincida con lo que suena.
  const headroom = ctx.createGain();
  headroom.gain.value = 0.5;
  const limiter = ctx.createWaveShaper();
  limiter.curve = softClipCurve(2049, 0.55, 0.92, 2);
  limiter.oversample = '2x';
  const ceiling = ctx.createWaveShaper(); // red de seguridad: el sobremuestreo del limitador puede rebasar un poco
  ceiling.curve = hardLimitCurve();

  const convolver = ctx.createConvolver();
  convolver.normalize = false; // la respuesta ya viene con energía unitaria
  convolver.buffer = assets.ir;
  const wet = ctx.createGain();
  wet.gain.value = 1;

  master.connect(headroom);
  headroom.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(ctx.destination);
  convolver.connect(wet);
  wet.connect(master);

  return { ctx, master, convolver, output: ceiling, assets };
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

  let sentinel: OscillatorNode;
  try {
    def.build({ r, out: bus, t: t0, dur, gain });
    // centinela mudo: su fin avisa que la voz terminó (sin setTimeout)
    sentinel = r.osc('sine', 1, t0, end + END_PAD);
    r.chain(sentinel, r.gain(0), rig.master);
  } catch (err) {
    r.stopAll(t0);
    r.dispose();
    throw err;
  }

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
