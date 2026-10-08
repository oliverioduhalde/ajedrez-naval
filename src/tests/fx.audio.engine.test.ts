import { afterEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../fx/audio/dsp';
import { createRig, scheduleVoice, voiceDuration } from '../fx/audio/graph';
import type { VoiceHandle } from '../fx/audio/graph';
import { SOUND_IDS, VOICES } from '../fx/audio/voices';
import type { SoundId } from '../fx/types';
import {
  FakeAudioContext, FakeContext, FakeOfflineAudioContext, FakeParam,
} from './fx.audio.fake';
import type { FakeNode, FakeSource } from './fx.audio.fake';

const g = globalThis as unknown as Record<string, unknown>;
const flush = () => new Promise<void>(r => setTimeout(r, 0));

const isSource = (n: FakeNode): n is FakeSource => n.kind === 'oscillator' || n.kind === 'bufferSource';
const paramsOf = (n: FakeNode): FakeParam[] => Object.values(n).filter((v): v is FakeParam => v instanceof FakeParam);

function schedule(id: SoundId, opts: { dur?: number; gain?: number } = {}, t0 = 10, onDone?: (h: VoiceHandle) => void) {
  const ctx = new FakeContext();
  const rig = createRig(ctx as unknown as BaseAudioContext, 1);
  const first = ctx.nodes.length;
  const handle = scheduleVoice(rig, id, t0, opts, mulberry32(1), onDone);
  const nodes = ctx.nodes.slice(first);
  return { ctx, rig, handle, nodes, sources: nodes.filter(isSource), bus: nodes[0], gate: nodes[1], t0 };
}

describe('el Web Audio falso hace cumplir las reglas del navegador', () => {
  const param = () => new FakeParam({ currentTime: 0 }, 1);

  it('rechaza rampas exponenciales a cero, curvas superpuestas y paradas sin arranque', () => {
    expect(() => param().exponentialRampToValueAtTime(0, 1)).toThrow();
    const p = param();
    p.setValueCurveAtTime([0, 1], 1, 1);
    expect(() => p.setValueCurveAtTime([1, 0], 1.5, 1)).toThrow();
    expect(() => p.setValueAtTime(0.5, 1.5)).toThrow();
    expect(() => p.setValueCurveAtTime([1, 0], 2, 1)).not.toThrow(); // justo al terminar la anterior
    expect(() => p.setValueCurveAtTime([1], 5, 1)).toThrow();
    expect(() => param().setValueAtTime(1, -1)).toThrow();
    expect(() => new FakeContext().createOscillator().stop(1)).toThrow();
  });
});

describe('grafo de cada voz (Web Audio falso)', () => {
  for (const id of SOUND_IDS) {
    const def = VOICES[id];
    const dur = def.fixed ?? 1.5;
    const opts = def.fixed === undefined ? { dur } : {};

    it(`${id}: se arma sin errores y todas las fuentes arrancan y paran dentro de la voz`, () => {
      const { sources, handle, t0 } = schedule(id, opts);
      expect(sources.length).toBeGreaterThan(1);
      expect(handle.start).toBe(t0);
      expect(handle.end).toBeCloseTo(t0 + dur, 9);
      for (const s of sources) {
        expect(s.started).toBe(true);
        expect(s.startTime).toBeGreaterThanOrEqual(t0 - 1e-9);
        expect(s.stopTime).toBeGreaterThanOrEqual(s.startTime);
        expect(s.stopTime).toBeLessThanOrEqual(t0 + dur + 0.05 + 1e-9);
      }
    });

    it(`${id}: la envolvente parte de 0, termina en 0 en t0+dur y llega al nivel de la voz`, () => {
      const { bus, t0 } = schedule(id, opts);
      const events = (bus.gain as FakeParam).events;
      const curves = events.filter(e => e.type === 'curve');
      expect(curves.length).toBe(2);
      const first = curves[0];
      const last = curves[curves.length - 1];
      expect(first.time).toBe(t0);
      expect(first.values![0]).toBe(0);
      expect(last.time + last.duration!).toBeCloseTo(t0 + dur, 9);
      expect(last.values![last.values!.length - 1]).toBe(0);
      expect(Math.max(...first.values!)).toBeCloseTo(def.level, 6);
      // el fade out arranca cuando termina el fade in o después: nunca se pisan
      expect(last.time).toBeGreaterThanOrEqual(first.time + first.duration! - 1e-12);
    });

    it(`${id}: no programa nada en el pasado y dispone de un único centinela mudo`, () => {
      const { nodes, ctx, t0 } = schedule(id, opts);
      for (const n of nodes) {
        for (const p of paramsOf(n)) {
          for (const ev of p.events) {
            const initial = ev.type === 'set' && ev.time === ctx.currentTime;
            expect(initial || ev.time >= t0 - 1e-9, `${n.kind} ${ev.type} t=${ev.time}`).toBe(true);
          }
        }
      }
      expect(nodes.filter(n => isSource(n) && n.onended).length).toBe(1);
    });

    it(`${id}: al terminar la voz se desconectan todos sus nodos (sin fugas) y avisa una sola vez`, () => {
      const done = vi.fn();
      const { nodes, handle, sources } = schedule(id, opts, 10, done);
      expect(handle.disposed).toBe(false);
      sources.find(s => s.onended)!.fireEnded();
      expect(handle.disposed).toBe(true);
      expect(done).toHaveBeenCalledTimes(1);
      for (const n of nodes) expect(n.disconnectCalls, n.kind).toBeGreaterThanOrEqual(1);
      handle.dispose();
      expect(done).toHaveBeenCalledTimes(1);
    });
  }

  it('el nivel de la voz escala con gain (acotado a 0..2)', () => {
    const peak = (gain: number) => {
      const curve = (schedule('explosion', { gain }).bus.gain as FakeParam).events.find(e => e.type === 'curve')!;
      return Math.max(...curve.values!);
    };
    expect(peak(1)).toBeCloseTo(VOICES.explosion.level, 6);
    expect(peak(0.5)).toBeCloseTo(VOICES.explosion.level * 0.5, 6);
    expect(peak(9)).toBeCloseTo(VOICES.explosion.level * 2, 6);
    expect(peak(-3)).toBe(0);
  });

  it('el gain de la explosión también cambia la cantidad de graves (sub del bombo)', () => {
    const subLevel = (gain: number) => {
      const { sources, nodes } = schedule('explosion', { gain });
      const sub = sources.find(s => s.kind === 'oscillator' && (s.frequency as FakeParam).events.some(e => e.type === 'exp' && e.value === 28))!;
      const warm = [...sub.outputs][0] as FakeNode; // bombo → saturación → envolvente
      const subEnv = [...warm.outputs][0] as FakeNode;
      expect(nodes.includes(subEnv)).toBe(true);
      return Math.max(...(subEnv.gain as FakeParam).events.filter(e => e.type === 'linear').map(e => e.value!));
    };
    expect(subLevel(1.4)).toBeGreaterThan(subLevel(0.4) * 1.5);
  });

  it('dur distinto cambia el largo de los sonidos variables y no el de los fijos', () => {
    expect(schedule('shipMove', { dur: 3 }).handle.end).toBeCloseTo(13, 9);
    expect(schedule('reconMove', { dur: 0.1 }).handle.end).toBeCloseTo(10 + VOICES.reconMove.minDur, 9);
    expect(schedule('cannon', { dur: 9 }).handle.end).toBeCloseTo(11.6, 9);
    expect(voiceDuration('torpedo', 2.4)).toBe(2.4);
  });

  it('kill apaga la voz con un fade corto y corta sus fuentes', () => {
    const { gate, sources, handle } = schedule('shipMove', { dur: 2 });
    handle.kill(10.5);
    const target = (gate.gain as FakeParam).events.find(e => e.type === 'target')!;
    expect(target.value).toBe(0);
    expect(target.time).toBe(10.5);
    expect(target.timeConstant!).toBeLessThan(0.05);
    for (const s of sources) expect(s.stopTime).toBeLessThanOrEqual(10.5 + 0.09 + 1e-9);
  });

  it('si una voz falla a medio armar, libera lo que creó y propaga el error', () => {
    const ctx = new FakeContext();
    const rig = createRig(ctx as unknown as BaseAudioContext, 1);
    const first = ctx.nodes.length;
    let calls = 0;
    const original = ctx.createBiquadFilter.bind(ctx);
    ctx.createBiquadFilter = () => {
      if (++calls === 3) throw new Error('boom');
      return original();
    };
    expect(() => scheduleVoice(rig, 'shipMove', 5, { dur: 1 }, mulberry32(1))).toThrow('boom');
    for (const n of ctx.nodes.slice(first)) expect(n.disconnectCalls, n.kind).toBeGreaterThanOrEqual(1);
  });

  it('cada ráfaga de metralla tiene unos 14 disparos por segundo', () => {
    const shots = (dur: number) => {
      const { nodes } = schedule('machineGun', { dur });
      const snap = nodes.find(n => n.kind === 'gain' && (n.gain as FakeParam).events.filter(e => e.type === 'linear').length > 3)!;
      return (snap.gain as FakeParam).events.filter(e => e.type === 'linear').length;
    };
    const one = shots(1);
    expect(one).toBeGreaterThanOrEqual(11);
    expect(one).toBeLessThanOrEqual(15);
    expect(shots(2)).toBeGreaterThan(one * 1.6);
  });
});

describe('motor en vivo (AudioContext falso)', () => {
  async function fresh() {
    vi.resetModules();
    FakeAudioContext.reset();
    g.AudioContext = FakeAudioContext;
    return import('../fx/audio/engine');
  }

  afterEach(() => {
    delete g.AudioContext;
    delete g.OfflineAudioContext;
    delete g.window;
    FakeAudioContext.reset();
  });

  const ctxOf = () => FakeAudioContext.instances[0];
  const masterOf = () => ctxOf().nodes[0];
  const lastMasterTarget = () => {
    const targets = (masterOf().gain as FakeParam).events.filter(e => e.type === 'target');
    return targets[targets.length - 1];
  };

  it('playSound no arranca el contexto: sin gesto previo no pasa nada', async () => {
    const audio = await fresh();
    expect(() => audio.playSound('cannon')).not.toThrow();
    expect(FakeAudioContext.instances.length).toBe(0);
    expect(audio.audioStats().created).toBe(0);
  });

  it('unlockAudio crea el contexto una sola vez y lo reanuda', async () => {
    const audio = await fresh();
    audio.unlockAudio();
    audio.unlockAudio();
    await flush();
    expect(FakeAudioContext.instances.length).toBe(1);
    expect(ctxOf().state).toBe('running');
    expect(ctxOf().options).toEqual({ latencyHint: 'interactive' });
    // cadena maestra: ganancia → limitador suave → tope → salida, más la reverb por convolución (sin compresor
    // dinámico: tiene estado y cambia de un navegador a otro)
    const kinds = ctxOf().nodes.map(n => n.kind);
    expect(kinds).not.toContain('compressor');
    expect(kinds).toContain('convolver');
    expect(kinds.filter(k => k === 'shaper').length).toBe(2);
    const convolver = ctxOf().nodes.find(n => n.kind === 'convolver')!;
    expect(convolver.normalize).toBe(false);
    expect(convolver.buffer).not.toBeNull();
  });

  it('programa con el reloj del contexto: arranque = ahora + adelanto + delay', async () => {
    const audio = await fresh();
    audio.unlockAudio();
    await flush();
    ctxOf().currentTime = 3;
    audio.playSound('shipMove', { dur: 1.2, delay: 0.5 });
    expect(audio.audioStats().created).toBe(1);
    const starts = ctxOf().nodes.filter(isSource).filter(s => s.kind === 'oscillator' && s.startTime > 0).map(s => s.startTime);
    expect(Math.min(...starts)).toBeCloseTo(3 + 0.012 + 0.5, 9);
  });

  it('tope de voces: al pasarse corta las más viejas', async () => {
    const audio = await fresh();
    audio.unlockAudio();
    await flush();
    ctxOf().currentTime = 1;
    for (let i = 0; i < 40; i++) audio.playSound('machineGun', { dur: 1 });
    expect(audio.audioStats().created).toBe(40);
    expect(audio.audioStats().active).toBe(audio.MAX_VOICES);
    const killed = ctxOf().nodes.filter(n => n.kind === 'gain' && (n.gain as FakeParam).events.some(e => e.type === 'target' && e.value === 0 && e.timeConstant === 0.012));
    expect(killed.length).toBe(40 - audio.MAX_VOICES);
  });

  it('las voces se liberan solas cuando terminan', async () => {
    const audio = await fresh();
    audio.unlockAudio();
    await flush();
    audio.playSound('sonar');
    audio.playSound('explosion', { gain: 1.2 });
    expect(audio.audioStats().active).toBe(2);
    for (const n of ctxOf().nodes) if (isSource(n)) n.fireEnded();
    const stats = audio.audioStats();
    expect(stats.active).toBe(0);
    expect(stats.finished).toBe(2);
  });

  it('contexto suspendido: reintenta resume() y si no lo logra ignora el sonido sin error', async () => {
    const audio = await fresh();
    FakeAudioContext.autoResume = false;
    audio.unlockAudio();
    await flush();
    expect(ctxOf().state).toBe('suspended');
    expect(() => audio.playSound('cannon')).not.toThrow();
    await flush();
    expect(audio.audioStats().created).toBe(0);
    FakeAudioContext.autoResume = true;
    audio.playSound('cannon');
    await flush();
    expect(ctxOf().state).toBe('running');
    expect(audio.audioStats().created).toBe(1);
  });

  it('volumen maestro con curva perceptual v², acotado a 0..1', async () => {
    const audio = await fresh();
    expect(audio.volumeToGain(0.5)).toBe(0.25);
    expect(audio.volumeToGain(1)).toBe(1);
    expect(audio.volumeToGain(2)).toBe(1);
    expect(audio.volumeToGain(-1)).toBe(0);
    audio.unlockAudio();
    await flush();
    expect((masterOf().gain as FakeParam).value).toBeCloseTo(0.64, 6); // 0,8² por defecto
    audio.setMasterVolume(0.5);
    expect(lastMasterTarget().value).toBe(0.25);
    audio.setMasterVolume(7);
    expect(lastMasterTarget().value).toBe(1);
    const events = (masterOf().gain as FakeParam).events.length;
    audio.setMasterVolume(1); // sin cambios: no ensucia la línea de tiempo
    audio.setMasterVolume(Number.NaN);
    expect((masterOf().gain as FakeParam).events.length).toBe(events);
  });

  it('setAudioEnabled(false) silencia y corta lo que suena; al volver a activar recupera el volumen', async () => {
    const audio = await fresh();
    audio.unlockAudio();
    await flush();
    audio.setMasterVolume(0.5);
    audio.playSound('shipMove', { dur: 2 });
    audio.playSound('reconMove', { dur: 2 });
    expect(audio.audioStats().active).toBe(2);
    audio.setAudioEnabled(false);
    expect(audio.audioStats().active).toBe(0);
    expect(lastMasterTarget().value).toBe(0);
    const killed = ctxOf().nodes.filter(n => n.kind === 'gain' && (n.gain as FakeParam).events.some(e => e.type === 'target' && e.value === 0 && e.timeConstant === 0.012));
    expect(killed.length).toBe(2);
    audio.playSound('cannon');
    expect(audio.audioStats().created).toBe(2);
    audio.setAudioEnabled(true);
    expect(lastMasterTarget().value).toBe(0.25);
    audio.playSound('cannon');
    expect(audio.audioStats().created).toBe(3);
  });

  it('un delay inválido cuenta como 0 y un navegador que rechace el grafo no rompe la partida', async () => {
    const audio = await fresh();
    audio.unlockAudio();
    await flush();
    ctxOf().currentTime = 2;
    audio.playSound('cannon', { delay: Number.NaN });
    audio.playSound('cannon', { delay: -5 });
    const starts = ctxOf().nodes.filter(isSource).filter(s => s.kind === 'oscillator' && s.startTime > 0).map(s => s.startTime);
    expect(Math.max(...starts)).toBeCloseTo(2.012 + 0.3, 6); // eco del cañonazo a +0,3 s
    expect(Math.min(...starts)).toBeCloseTo(2.012, 9);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ctxOf().createGain = () => {
      throw new Error('rechazado');
    };
    expect(() => audio.playSound('sonar')).not.toThrow();
    expect(audio.audioStats().created).toBe(2);
    expect(audio.audioStats().active).toBe(2);
    warn.mockRestore();
  });

  it('gain 0 no crea voz y un id desconocido se ignora', async () => {
    const audio = await fresh();
    audio.unlockAudio();
    await flush();
    audio.playSound('cannon', { gain: 0 });
    audio.playSound('nope' as SoundId);
    expect(audio.audioStats().created).toBe(0);
  });

  it('registra una sola vez los listeners de gesto y el primer gesto desbloquea el audio', async () => {
    const added: { type: string; fn: () => void }[] = [];
    g.window = { addEventListener: (type: string, fn: () => void) => added.push({ type, fn }) };
    const audio = await fresh();
    audio.unlockAudio();
    audio.unlockAudio();
    audio.unlockAudio();
    const types = added.map(a => a.type);
    expect(new Set(types).size).toBe(types.length);
    for (const t of ['pointerdown', 'keydown', 'touchend']) expect(types).toContain(t);
    expect(FakeAudioContext.instances.length).toBe(1); // unlockAudio sin userActivation (Node): se asume gesto
    added.find(a => a.type === 'keydown')!.fn();
    await flush();
    expect(FakeAudioContext.instances.length).toBe(1);
    expect(ctxOf().state).toBe('running');
  });

  it('unlockAudio fuera de un gesto no crea el contexto: espera al primer evento real', async () => {
    const added: { type: string; fn: () => void }[] = [];
    g.window = { addEventListener: (type: string, fn: () => void) => added.push({ type, fn }) };
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { userActivation: { isActive: false } }, configurable: true });
    try {
      const audio = await fresh();
      audio.unlockAudio();
      expect(FakeAudioContext.instances.length).toBe(0);
      added.find(a => a.type === 'pointerdown')!.fn();
      await flush();
      expect(FakeAudioContext.instances.length).toBe(1);
      expect(ctxOf().state).toBe('running');
    } finally {
      if (saved) Object.defineProperty(globalThis, 'navigator', saved);
      else delete g.navigator;
    }
  });
});

describe('renderSoundOffline (OfflineAudioContext falso)', () => {
  afterEach(() => {
    delete g.OfflineAudioContext;
  });

  async function engine() {
    vi.resetModules();
    g.OfflineAudioContext = FakeOfflineAudioContext;
    return import('../fx/audio/engine');
  }

  it('arma el mismo grafo que el motor en vivo y devuelve un buffer estéreo del largo de la voz más la cola', async () => {
    const audio = await engine();
    const buf = await audio.renderSoundOffline('cannon');
    expect(buf).not.toBeNull();
    expect(buf!.numberOfChannels).toBe(2);
    expect(buf!.sampleRate).toBe(44100);
    expect(buf!.length).toBe(Math.ceil((1.6 + VOICES.cannon.tail) * 44100));
    const ctx = FakeOfflineAudioContext.last!;
    const kinds = ctx.nodes.map(n => n.kind);
    expect(kinds).not.toContain('compressor');
    expect(kinds).toContain('convolver');
    expect(kinds.filter(k => k === 'shaper').length).toBeGreaterThanOrEqual(2); // limitador + tope (el cañonazo suma el suyo)
    expect((ctx.nodes[0].gain as FakeParam).events[0].value).toBe(1); // maestra a volumen pleno
    const starts = ctx.nodes.filter(isSource).map(s => s.startTime);
    expect(Math.min(...starts)).toBe(0);
  });

  it('respeta dur en los variables y devuelve null con un id desconocido o si el render falla', async () => {
    const audio = await engine();
    const buf = await audio.renderSoundOffline('shipMove', { dur: 2 });
    expect(buf!.length).toBe(Math.ceil((2 + VOICES.shipMove.tail) * 44100));
    expect(await audio.renderSoundOffline('nope' as SoundId)).toBeNull();
    class Broken extends FakeOfflineAudioContext {
      override startRendering(): Promise<never> {
        return Promise.reject(new Error('sin memoria'));
      }
    }
    g.OfflineAudioContext = Broken;
    expect(await audio.renderSoundOffline('sonar')).toBeNull();
  });

  it('soporta navegadores viejos que avisan por oncomplete en vez de devolver una promesa', async () => {
    const audio = await engine();
    class Legacy extends FakeOfflineAudioContext {
      oncomplete: ((ev: { renderedBuffer: unknown }) => void) | null = null;
      override startRendering(): Promise<never> {
        queueMicrotask(() => this.oncomplete?.({ renderedBuffer: { length: this.length, legacy: true } }));
        return undefined as unknown as Promise<never>;
      }
    }
    g.OfflineAudioContext = Legacy;
    const buf = (await audio.renderSoundOffline('splashSmall')) as unknown as { legacy: boolean } | null;
    expect(buf?.legacy).toBe(true);
  });
});
