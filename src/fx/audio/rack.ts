/**
 * Piezas compartidas del grafo de audio: buffers de ruido y reverb cacheados por frecuencia de muestreo,
 * y el "rack" que crea los nodos de una voz y los desconecta todos al terminar.
 */
import { brownNoise, impulseResponse, mulberry32, whiteNoise } from './dsp';
import type { F32 } from './dsp';

export interface Assets {
  white: AudioBuffer;
  brown: AudioBuffer;
  ir: AudioBuffer;
}

const cache = new Map<number, Assets>();

function bufferOf(ctx: BaseAudioContext, channels: F32[]): AudioBuffer {
  const buf = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((data, i) => buf.copyToChannel(data, i));
  return buf;
}

/** Los buffers se generan una sola vez por frecuencia de muestreo y los comparten todas las voces. */
export function getAssets(ctx: BaseAudioContext): Assets {
  const hit = cache.get(ctx.sampleRate);
  if (hit) return hit;
  const sr = ctx.sampleRate;
  const assets: Assets = {
    white: bufferOf(ctx, [whiteNoise(Math.floor(sr * 2), mulberry32(0x51a7))]),
    brown: bufferOf(ctx, [brownNoise(Math.floor(sr * 4), mulberry32(0xb20f))]),
    ir: bufferOf(ctx, impulseResponse(sr, 1.6, mulberry32(0x7e12))),
  };
  cache.set(sr, assets);
  return assets;
}

export class Rack {
  readonly ctx: BaseAudioContext;
  readonly assets: Assets;
  readonly rng: () => number;
  /** instante más allá del cual ninguna fuente debe seguir sonando (fin de la voz) */
  limit = Infinity;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];

  constructor(ctx: BaseAudioContext, assets: Assets, rng: () => number) {
    this.ctx = ctx;
    this.assets = assets;
    this.rng = rng;
  }

  gain(value = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    this.nodes.push(f);
    return f;
  }

  shaper(curve: F32, oversample: OverSampleType = '2x'): WaveShaperNode {
    const s = this.ctx.createWaveShaper();
    s.curve = curve;
    s.oversample = oversample;
    this.nodes.push(s);
    return s;
  }

  osc(type: OscillatorType, frequency: number, start: number, stop: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.start(start);
    o.stop(Math.max(start, Math.min(stop, this.limit)));
    this.nodes.push(o);
    this.sources.push(o);
    return o;
  }

  /** Ruido en bucle, con arranque en un punto al azar para que dos voces no suenen idénticas. */
  noise(kind: 'white' | 'brown', start: number, stop: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    const buffer = kind === 'white' ? this.assets.white : this.assets.brown;
    s.buffer = buffer;
    s.loop = true;
    s.start(start, this.rng() * buffer.duration);
    s.stop(Math.max(start, Math.min(stop, this.limit)));
    this.nodes.push(s);
    this.sources.push(s);
    return s;
  }

  /** Conecta en serie; el último puede ser un AudioParam (modulación). Devuelve el último nodo conectado. */
  chain(first: AudioNode, ...rest: (AudioNode | AudioParam)[]): AudioNode {
    let prev = first;
    for (const n of rest) {
      if ('connect' in n) {
        prev.connect(n);
        prev = n;
      } else {
        prev.connect(n);
        break;
      }
    }
    return prev;
  }

  /** Corta todas las fuentes en `when` (las que no empezaron todavía nunca suenan). */
  stopAll(when: number): void {
    for (const s of this.sources) {
      try {
        s.stop(when);
      } catch {
        /* ya terminada */
      }
    }
  }

  dispose(): void {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ya desconectado */
      }
    }
    this.nodes = [];
    this.sources = [];
  }
}
