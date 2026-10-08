/**
 * Motor de audio en vivo: un AudioContext que se crea o reanuda solo dentro de un gesto del usuario,
 * tope de voces simultáneas y silencio/volumen maestro. Sin AudioContext (SSR, jsdom) todo es no-op.
 */
import type { SoundId } from '../types';
import { clamp, hashString, mulberry32 } from './dsp';
import { createRig, scheduleVoice, voiceDuration } from './graph';
import type { Rig, VoiceHandle } from './graph';
import type { PlayOpts } from './types';
import { VOICES } from './voices';

/** Voces simultáneas máximas: al pasarse se corta la más vieja. */
export const MAX_VOICES = 16;
/** Adelanto mínimo con que se programa cada voz para no perder el arranque. */
const LOOKAHEAD = 0.012;
/** Si el contexto tarda más que esto en reanudarse, el sonido ya no tiene sentido y se descarta. */
const RESUME_GRACE_MS = 250;

type AudioCtor = typeof AudioContext;
type OfflineCtor = typeof OfflineAudioContext;

interface Engine {
  ctx: AudioContext;
  rig: Rig;
}

let engine: Engine | null = null;
let enabled = true;
let volume = 0.8;
let listening = false;
const live = new Set<VoiceHandle>();
let created = 0;
let finished = 0;

const noop = () => {};

function audioCtor(): AudioCtor | null {
  const g = globalThis as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

/** Curva perceptual del volumen: la mitad del recorrido del control no suena como la mitad de fuerte. */
export const volumeToGain = (v: number) => clamp(v, 0, 1) ** 2;

function masterTarget(): number {
  return enabled ? volumeToGain(volume) : 0;
}

function ensureEngine(): Engine | null {
  if (engine) return engine;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor({ latencyHint: 'interactive' });
    engine = { ctx, rig: createRig(ctx, masterTarget()) };
    // iOS Safari solo libera el audio si dentro del gesto suena algo: una muestra de silencio
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    engine = null;
  }
  return engine;
}

function userGestureActive(): boolean {
  const ua = (globalThis.navigator as Navigator | undefined)?.userActivation;
  return ua ? ua.isActive : true;
}

function unlock(): void {
  const e = ensureEngine();
  if (!e || e.ctx.state === 'running' || e.ctx.state === 'closed') return;
  try {
    void Promise.resolve(e.ctx.resume()).catch(noop);
  } catch {
    /* sin gesto no se puede: se reintenta en el próximo */
  }
}

const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click'] as const;

function installGestureListeners(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true });
}

/** Crea o reanuda el AudioContext. Hay que llamarla desde un gesto (click, tecla, toque). */
export function unlockAudio(): void {
  installGestureListeners();
  if (userGestureActive()) unlock();
}

function sweep(now: number): void {
  for (const v of live) if (v.end < now - 0.5) v.dispose();
}

function begin(e: Engine, id: SoundId, opts: PlayOpts): void {
  const now = e.ctx.currentTime;
  sweep(now);
  while (live.size >= MAX_VOICES) {
    const oldest = live.values().next().value as VoiceHandle;
    live.delete(oldest);
    oldest.kill(now);
  }
  const t0 = now + LOOKAHEAD + Math.max(0, opts.delay ?? 0);
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  const handle = scheduleVoice(e.rig, id, t0, opts, rng, h => {
    live.delete(h);
    finished++;
  });
  live.add(handle);
  created++;
}

export function playSound(id: SoundId, opts: PlayOpts = {}): void {
  if (!enabled || !VOICES[id]) return;
  const e = engine;
  if (!e) return; // nadie desbloqueó el audio todavía: no se puede arrancar fuera de un gesto
  const { state } = e.ctx;
  if (state === 'running') {
    begin(e, id, opts);
    return;
  }
  if (state === 'closed') return;
  const asked = Date.now();
  try {
    void Promise.resolve(e.ctx.resume()).then(() => {
      const waited = Date.now() - asked;
      if (e.ctx.state !== 'running' || waited > RESUME_GRACE_MS || !enabled) return;
      begin(e, id, { ...opts, delay: Math.max(0, (opts.delay ?? 0) - waited / 1000) });
    }, noop);
  } catch {
    /* ignorado */
  }
}

function killAll(): void {
  if (!engine) return;
  const now = engine.ctx.currentTime;
  for (const v of [...live]) v.kill(now);
  live.clear();
}

function applyMaster(): void {
  if (!engine) return;
  const { ctx, rig } = engine;
  rig.master.gain.setTargetAtTime(masterTarget(), ctx.currentTime, 0.02);
}

export function setAudioEnabled(on: boolean): void {
  enabled = on;
  if (!on) killAll();
  applyMaster();
}

export function setMasterVolume(v: number): void {
  volume = Number.isFinite(v) ? clamp(v, 0, 1) : volume;
  applyMaster();
}

const SAMPLE_RATE = 44100;

/** Renderiza un sonido con el mismo grafo y las mismas voces que `playSound`, sin tocar los altavoces. */
export async function renderSoundOffline(id: SoundId, opts: PlayOpts = {}): Promise<AudioBuffer | null> {
  const Ctor = offlineCtor();
  if (!Ctor || !VOICES[id]) return null;
  try {
    const dur = voiceDuration(id, opts.dur);
    const ctx = new Ctor(2, Math.ceil((dur + VOICES[id].tail) * SAMPLE_RATE), SAMPLE_RATE);
    const rig = createRig(ctx, volumeToGain(1));
    scheduleVoice(rig, id, 0, opts, mulberry32(hashString(id)));
    return await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.startRendering() as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, reject);
      else ctx.oncomplete = ev => resolve(ev.renderedBuffer);
    });
  } catch {
    return null;
  }
}

/** Para pruebas y depuración: estado del motor. */
export function audioStats() {
  return {
    hasContext: engine !== null,
    state: engine?.ctx.state ?? 'none',
    enabled,
    volume,
    active: live.size,
    created,
    finished,
  };
}

installGestureListeners();

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__audio = { stats: audioStats, renderSoundOffline };
}
