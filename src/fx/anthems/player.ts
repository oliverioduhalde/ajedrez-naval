/**
 * Himnos en 8 bit: la parte más famosa del himno de cada facción, tocada con onda de pulso y un
 * bajo triangular, cuantizada en escalones (bit-crusher). Cada nota tiene un decay suave, que
 * sigue sonando sobre las siguientes, y todo pasa por una reverb de sala generada en el momento.
 * Usa su propio AudioContext (no depende del motor de efectos de combate) y respeta el mute y el
 * volumen de los ajustes. Sin AudioContext (SSR, pruebas) todo es no-op.
 */
import type { FactionId } from '../../config/factions';
import { useSettings } from '../../store/settingsStore';
import { ANTHEMS, noteFreq, type AnthemNote } from './data';

type Ctor = typeof AudioContext;

interface Rig {
  ctx: AudioContext;
  master: GainNode;
  crush: WaveShaperNode;
  send: GainNode;
  pulse: PeriodicWave;
}

let rig: Rig | null = null;
let current: { stop: () => void } | null = null;
let listening = false;

const CRUSH_LEVELS = 24;
const REVERB_SECONDS = 2.4;
const REVERB_MIX = 0.42;

function ctor(): Ctor | null {
  const g = globalThis as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Escalones de amplitud: el timbre áspero de los chips de 8 bits. */
export function crushCurve(levels: number, size = 1025): Float32Array<ArrayBuffer> {
  const c = new Float32Array(size) as Float32Array<ArrayBuffer>;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    c[i] = Math.round(x * levels) / levels;
  }
  return c;
}

/** Onda de pulso con ancho `duty` (0,25 = el timbre clásico de la NES), por serie de Fourier. */
export function pulseCoefficients(duty: number, harmonics = 64): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    real[n] = (2 * Math.sin(2 * Math.PI * n * duty)) / (Math.PI * n);
    imag[n] = (2 * (1 - Math.cos(2 * Math.PI * n * duty))) / (Math.PI * n);
  }
  return { real, imag };
}

function reverbBuffer(ctx: AudioContext): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * REVERB_SECONDS);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const noise = Math.random() * 2 - 1;
      lp += (noise - lp) * (0.55 - 0.4 * t); // la cola se va oscureciendo
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
  }
  return buf;
}

function build(ctx: AudioContext): Rig {
  const master = ctx.createGain();
  master.gain.value = 0;
  const crush = ctx.createWaveShaper();
  crush.curve = crushCurve(CRUSH_LEVELS);
  crush.oversample = 'none';
  const dry = ctx.createGain();
  dry.gain.value = 1;
  const send = ctx.createGain();
  send.gain.value = REVERB_MIX;
  const conv = ctx.createConvolver();
  conv.buffer = reverbBuffer(ctx);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  crush.connect(dry);
  crush.connect(send);
  send.connect(conv);
  dry.connect(master);
  conv.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);
  const { real, imag } = pulseCoefficients(0.25);
  return { ctx, master, crush, send, pulse: ctx.createPeriodicWave(real, imag) };
}

function ensure(): Rig | null {
  if (rig) return rig;
  const C = ctor();
  if (!C) return null;
  try {
    rig = build(new C({ latencyHint: 'interactive' }));
  } catch {
    rig = null;
  }
  return rig;
}

function unlock(): void {
  const r = ensure();
  if (r && r.ctx.state === 'suspended') void Promise.resolve(r.ctx.resume()).catch(() => {});
}

/** Crea o reanuda el contexto. Hay que llamarla desde un gesto (clic, toque, tecla). */
export function unlockAnthemAudio(): void {
  installListeners();
  unlock();
}

function installListeners(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  for (const t of ['pointerdown', 'keydown', 'touchend', 'click'] as const) {
    window.addEventListener(t, unlock, { capture: true, passive: true });
  }
}

/** Volumen efectivo de los himnos: mismos ajustes de sonido del juego, con curva perceptual. */
function level(): number {
  const { soundOn, soundVolume } = useSettings.getState();
  if (!soundOn) return 0;
  const v = Math.min(1, Math.max(0, soundVolume));
  return v * v * 0.9;
}

export function anthemSeconds(id: FactionId): number {
  const a = ANTHEMS[id];
  return a.notes.reduce((s, n) => s + n[1], 0) * 60 / a.bpm;
}

function schedule(r: Rig, notes: AnthemNote[], bpm: number, t0: number, out: AudioNode): { end: number; nodes: AudioScheduledSourceNode[] } {
  const beat = 60 / bpm;
  const nodes: AudioScheduledSourceNode[] = [];
  let t = t0;
  for (const [pitch, beats] of notes) {
    const dur = beats * beat;
    const f = noteFreq(pitch);
    if (f !== null) {
      const hold = Math.min(dur * 0.35, 0.18);
      const tail = Math.max(0.18, dur * 0.9) + 0.25; // decay suave que se solapa con la nota siguiente
      const voices: [OscillatorNode, number][] = [];
      const lead = r.ctx.createOscillator();
      lead.setPeriodicWave(r.pulse);
      lead.frequency.value = f;
      voices.push([lead, 0.34]);
      const bass = r.ctx.createOscillator();
      bass.type = 'triangle';
      bass.frequency.value = f / 2;
      voices.push([bass, 0.3]);
      for (const [osc, peak] of voices) {
        const g = r.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.004);
        g.gain.setValueAtTime(peak, t + hold);
        g.gain.exponentialRampToValueAtTime(0.0008, t + hold + tail);
        osc.connect(g);
        g.connect(out);
        osc.start(t);
        osc.stop(t + hold + tail + 0.05);
        nodes.push(osc);
      }
    }
    t += dur;
  }
  return { end: t, nodes };
}

/** Detiene el himno que esté sonando (por ejemplo al empezar una partida nueva). */
export function stopAnthem(): void {
  current?.stop();
  current = null;
}

/** Toca el himno de la facción. Devuelve la duración en segundos (0 si no sonó). */
export function playAnthem(id: FactionId): number {
  const data = ANTHEMS[id];
  const r = ensure();
  if (!data || !r) return 0;
  installListeners();
  const gain = level();
  if (gain <= 0) return 0;
  stopAnthem();
  if (r.ctx.state === 'suspended') void Promise.resolve(r.ctx.resume()).catch(() => {});
  const now = r.ctx.currentTime;
  const t0 = now + 0.06;
  r.master.gain.cancelScheduledValues(now);
  r.master.gain.setValueAtTime(0, now);
  r.master.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  const { end, nodes } = schedule(r, data.notes, data.bpm, t0, r.crush);
  const done = end + REVERB_SECONDS * 0.8;
  r.master.gain.setValueAtTime(gain, done);
  r.master.gain.linearRampToValueAtTime(0, done + 0.9); // deja que la cola de reverb se apague sola, sin corte
  const handle = {
    stop: () => {
      const n = r.ctx.currentTime;
      r.master.gain.cancelScheduledValues(n);
      r.master.gain.setTargetAtTime(0, n, 0.04);
      for (const o of nodes) {
        try { o.stop(n + 0.2); } catch { /* ya terminó */ }
      }
    },
  };
  current = handle;
  return end - t0;
}
