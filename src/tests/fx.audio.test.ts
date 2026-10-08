import { describe, expect, it } from 'vitest';
import type { SoundId } from '../fx/types';
import * as api from '../fx/audio';
import {
  brownNoise, bubbleTimes, crackleTimes, dopplerCurve, fadeCurve, hardLimitCurve,
  impulseResponse, mulberry32, saturationCurve, shotTimes, smoothRandom, softClipCurve, splitFades, whiteNoise,
} from '../fx/audio/dsp';
import { voiceDuration } from '../fx/audio/graph';
import { SOUND_IDS, VOICES } from '../fx/audio/voices';

// Si el contrato agrega un SoundId, este registro deja de compilar hasta que el motor lo cubra.
const ALL_IDS: Record<SoundId, true> = {
  sonar: true, shipMove: true, reconMove: true, fighterDive: true, cannon: true,
  torpedo: true, machineGun: true, explosion: true, splash: true, splashSmall: true,
};

const rms = (d: ArrayLike<number>, a = 0, b = d.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += d[i] * d[i];
  return Math.sqrt(s / (b - a));
};

describe('SOUND_LIST', () => {
  it('cubre exactamente los SoundId del contrato, sin repetir', () => {
    const ids = api.SOUND_LIST.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(ALL_IDS).sort());
    expect([...SOUND_IDS].sort()).toEqual(Object.keys(ALL_IDS).sort());
  });

  it('tiene rótulo, descripción en español y duración por defecto', () => {
    for (const s of api.SOUND_LIST) {
      expect(s.label.length, s.id).toBeGreaterThan(2);
      expect(s.blurb.length, s.id).toBeGreaterThan(10);
      expect(s.defaultDur, s.id).toBeGreaterThan(0.3);
    }
    expect(api.SOUND_LIST.find(s => s.id === 'sonar')!.label).toBe('Sonar del submarino');
    expect(api.SOUND_LIST.find(s => s.id === 'cannon')!.label).toBe('Cañonazo');
  });

  it('la duración por defecto de los fijos coincide con su duración real', () => {
    for (const s of api.SOUND_LIST) {
      const def = VOICES[s.id];
      if (def.fixed !== undefined) expect(s.defaultDur, s.id).toBe(def.fixed);
    }
  });

  it('exporta exactamente la API pública del contrato', () => {
    expect(Object.keys(api).sort()).toEqual(
      ['SOUND_LIST', 'playSound', 'renderSoundOffline', 'setAudioEnabled', 'setMasterVolume', 'unlockAudio'],
    );
  });
});

describe('duración de las voces', () => {
  it('los sonidos fijos ignoran dur y los variables la acotan', () => {
    expect(voiceDuration('cannon', 9)).toBe(1.6);
    expect(voiceDuration('sonar')).toBe(2.3);
    expect(voiceDuration('shipMove', 1.5)).toBe(1.5);
    expect(voiceDuration('shipMove', 99)).toBe(VOICES.shipMove.maxDur);
    expect(voiceDuration('shipMove', 0)).toBe(VOICES.shipMove.minDur);
    expect(voiceDuration('reconMove', Number.NaN)).toBe(VOICES.reconMove.defaultDur);
    expect(voiceDuration('machineGun', undefined)).toBe(VOICES.machineGun.defaultDur);
  });

  it('los fades de entrada y salida caben en la duración', () => {
    for (const id of SOUND_IDS) {
      const def = VOICES[id];
      for (const dur of [def.minDur, def.defaultDur, def.maxDur]) {
        const f = splitFades(dur, def.fadeIn(dur), def.fadeOut(dur));
        expect(f.fadeIn, id).toBeGreaterThan(0);
        expect(f.fadeOut, id).toBeGreaterThan(0);
        expect(f.fadeIn + f.hold + f.fadeOut, id).toBeCloseTo(dur, 9);
      }
    }
  });

  it('respeta las proporciones pedidas para barco, avión recon y caza', () => {
    const d = 2;
    expect(VOICES.shipMove.fadeIn(d) / d).toBeCloseTo(0.35, 6);
    expect(VOICES.shipMove.fadeOut(d) / d).toBeCloseTo(0.4, 6);
    expect(VOICES.reconMove.fadeIn(d) / d).toBeCloseTo(0.35, 6);
    expect(VOICES.reconMove.fadeOut(d) / d).toBeCloseTo(0.35, 6);
    expect(VOICES.fighterDive.fadeIn(d) / d).toBeCloseTo(0.25, 6);
    expect(VOICES.fighterDive.fadeOut(d) / d).toBeCloseTo(0.35, 6);
  });
});

describe('envolventes', () => {
  it('splitFades reparte la duración y encoge los fades si se pisan', () => {
    expect(splitFades(2, 0.5, 0.5)).toEqual({ fadeIn: 0.5, fadeOut: 0.5, hold: 1 });
    const f = splitFades(1, 0.8, 0.8);
    expect(f.fadeIn + f.fadeOut).toBeCloseTo(1, 9);
    expect(f.hold).toBe(0);
    expect(f.fadeIn).toBeCloseTo(f.fadeOut, 9);
    expect(splitFades(1, -1, 0.2).fadeIn).toBe(0);
  });

  it('fadeCurve es un coseno elevado: extremos exactos, monótona y con pendiente nula en los bordes', () => {
    const up = fadeCurve(101, 0, 1);
    expect(up[0]).toBe(0);
    expect(up[100]).toBeCloseTo(1, 6);
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeGreaterThanOrEqual(up[i - 1]);
    expect(up[1] - up[0]).toBeLessThan(0.001);
    expect(up[100] - up[99]).toBeLessThan(0.001);
    expect(up[50]).toBeCloseTo(0.5, 5);
    const down = fadeCurve(64, 0.8, 0);
    expect(down[0]).toBeCloseTo(0.8, 6);
    expect(down[63]).toBeCloseTo(0, 6);
  });
});

describe('curvas', () => {
  it('dopplerCurve va de 1+depth a 1-depth pasando por 1 en el centro', () => {
    const c = dopplerCurve(101, 0.03);
    expect(c[0]).toBeCloseTo(1.03, 6);
    expect(c[100]).toBeCloseTo(0.97, 6);
    expect(c[50]).toBeCloseTo(1, 6);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1] + 1e-9);
  });

  it('softClipCurve es lineal bajo la rodilla, impar, monótona y nunca pasa del techo', () => {
    const n = 2049;
    const c = softClipCurve(n, 0.55, 0.92, 2);
    for (let i = 0; i < n; i++) {
      const x = 2 * (-1 + (2 * i) / (n - 1));
      if (Math.abs(x) <= 0.55) expect(c[i]).toBeCloseTo(x, 5);
      expect(Math.abs(c[i])).toBeLessThanOrEqual(0.92);
      expect(c[i]).toBeCloseTo(-c[n - 1 - i], 6);
      if (i > 0) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    }
    expect(c[n - 1]).toBeGreaterThan(0.9);
  });

  it('hardLimitCurve recorta exactamente en el techo', () => {
    const c = hardLimitCurve(2001, 0.945);
    expect(Math.max(...c)).toBeCloseTo(0.945, 6);
    expect(Math.min(...c)).toBeCloseTo(-0.945, 6);
    expect(c[1000]).toBeCloseTo(0, 9);
    expect(c[1500]).toBeCloseTo(0.5, 6);
  });

  it('saturationCurve es impar y normalizada a ±1', () => {
    const c = saturationCurve(1001, 2.6);
    expect(c[0]).toBeCloseTo(-1, 6);
    expect(c[1000]).toBeCloseTo(1, 6);
    expect(c[500]).toBeCloseTo(0, 9);
    expect(c[750]).toBeGreaterThan(0.5); // más que lineal: satura
  });

  it('smoothRandom queda en [0,1] y usa todo el rango', () => {
    const c = smoothRandom(64, mulberry32(3));
    expect(Math.min(...c)).toBe(0);
    expect(Math.max(...c)).toBe(1);
    expect(c.length).toBe(64);
  });
});

describe('ruido y reverb generados', () => {
  it('mulberry32 es determinista y distribuye en [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((s, v) => s + v, 0) / xs.length).toBeCloseTo(0.5, 1);
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('el ruido blanco tiene el RMS previsto y se repite sin salto', () => {
    const n = whiteNoise(20000, mulberry32(7));
    expect(n.length).toBe(20000);
    expect(rms(n)).toBeGreaterThan(0.3);
    expect(rms(n)).toBeLessThan(0.4);
    expect(Math.max(...n.map(Math.abs))).toBeLessThanOrEqual(0.6 * Math.SQRT2 + 1e-6); // el cruce del bucle suma dos tramos
  });

  it('el ruido marrón es grave, de pico 0,9 y su unión de bucle es continua', () => {
    const n = brownNoise(40000, mulberry32(11));
    expect(Math.max(...n.map(Math.abs))).toBeCloseTo(0.9, 5);
    let step = 0;
    for (let i = 1; i < n.length; i++) step += Math.abs(n[i] - n[i - 1]);
    step /= n.length - 1;
    expect(Math.abs(n[0] - n[n.length - 1])).toBeLessThan(step * 6);
    // un ruido marrón se mueve despacio: el paso medio es mucho menor que su amplitud
    expect(step).toBeLessThan(rms(n) * 0.2);
    // sin corriente continua: el nivel medio es despreciable frente al RMS
    const mean = n.reduce((s, v) => s + v, 0) / n.length;
    expect(Math.abs(mean)).toBeLessThan(rms(n) * 0.01);
  });

  it('la respuesta al impulso es estéreo, decae y llega a cero exacto', () => {
    const sr = 22050;
    const [l, r] = impulseResponse(sr, 1.6, mulberry32(5));
    expect(l.length).toBe(Math.floor(sr * 1.6));
    expect(r.length).toBe(l.length);
    expect(l[l.length - 1]).toBe(0);
    expect(r[r.length - 1]).toBe(0);
    expect(l.every(Number.isFinite)).toBe(true);
    // energía unitaria por canal: la reverb devuelve tanto como recibe
    for (const ch of [l, r]) expect(ch.reduce((s, v) => s + v * v, 0)).toBeCloseTo(1, 4);
    const early = rms(l, Math.floor(sr * 0.05), Math.floor(sr * 0.25));
    const late = rms(l, l.length - Math.floor(sr * 0.2), l.length);
    expect(late).toBeLessThan(early * 0.02);
    // los dos canales son distintos (ancho estéreo)
    let same = 0;
    for (let i = 0; i < l.length; i++) if (l[i] === r[i]) same++;
    expect(same / l.length).toBeLessThan(0.01);
  });
});

describe('calendarios aleatorios', () => {
  it('shotTimes da ~14 disparos por segundo, ordenados y bien espaciados', () => {
    const t = shotTimes(1, 14, mulberry32(9));
    expect(t.length).toBeGreaterThanOrEqual(13);
    expect(t.length).toBeLessThanOrEqual(15);
    for (let i = 0; i < t.length; i++) {
      expect(t[i]).toBeGreaterThanOrEqual(0);
      expect(t[i]).toBeLessThan(1);
      if (i) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(0.045 - 1e-9);
    }
    expect(shotTimes(0, 14, mulberry32(1))).toEqual([]);
  });

  it('shotTimes a 13-15 Hz mantiene el ritmo con rachas largas', () => {
    for (const rate of [13, 14, 15]) {
      const t = shotTimes(3, rate, mulberry32(rate));
      expect(t.length).toBeGreaterThanOrEqual(Math.floor(3 * rate) - 1);
      expect(t.length).toBeLessThanOrEqual(Math.ceil(3 * rate));
    }
  });

  it('bubbleTimes son burbujas cada vez más escasas', () => {
    const t = bubbleTimes(12, 1.35, mulberry32(4), 0.05);
    expect(t.length).toBe(12);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
    expect(t[0]).toBeGreaterThanOrEqual(0.05);
    expect(t[t.length - 1]).toBeLessThanOrEqual(1.35);
    const firstHalf = t.filter(x => x < 0.7).length;
    expect(firstHalf).toBeGreaterThan(t.length - firstHalf);
  });

  it('crackleTimes son más densos al principio y nunca quedan a menos de 4 ms', () => {
    const t = crackleTimes(46, 1.2, mulberry32(8));
    expect(t.length).toBeGreaterThan(30);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(0.004 - 1e-9);
    const early = t.filter(x => x < 0.4).length;
    const late = t.filter(x => x > 0.8).length;
    expect(early).toBeGreaterThan(late);
  });
});

describe('sin AudioContext (Node, jsdom, SSR)', () => {
  it('todo es no-op y no lanza', async () => {
    expect(() => {
      api.unlockAudio();
      api.setAudioEnabled(false);
      api.setAudioEnabled(true);
      api.setMasterVolume(0.3);
      api.setMasterVolume(Number.NaN);
      for (const id of SOUND_IDS) api.playSound(id, { delay: 0.1, dur: 1, gain: 1.2 });
      api.playSound('nope' as SoundId);
    }).not.toThrow();
    for (const id of SOUND_IDS) expect(await api.renderSoundOffline(id, { dur: 1 })).toBeNull();
  });
});
