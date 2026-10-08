/** Automatización de AudioParam: golpes, barridos y la envolvente de entrada/salida de cada voz. */
import { curvePoints, fadeCurve, splitFades } from './dsp';
import type { F32 } from './dsp';

/** Ataque lineal corto y decaimiento exponencial hacia 0 (golpes, chasquidos, pings). */
export function strike(p: AudioParam, t: number, peak: number, attack: number, tau: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(0, t + attack, tau);
}

/** Barrido exponencial de `from` a `to` en `over` segundos, que luego queda en `to`. */
export function glide(p: AudioParam, t: number, from: number, to: number, over: number): void {
  p.setValueAtTime(from, t);
  p.exponentialRampToValueAtTime(to, t + over);
}

/** Multiplica una curva por un valor base y la aplica como automatización de `dur` segundos. */
export function followCurve(p: AudioParam, t: number, dur: number, base: number, factors: F32): void {
  const values = new Float32Array(factors.length);
  for (let i = 0; i < factors.length; i++) values[i] = base * factors[i];
  p.setValueCurveAtTime(values, t, dur);
}

/**
 * Envolvente de la voz: 0 → peak con coseno elevado en `fadeIn`, meseta, peak → 0 en `fadeOut`.
 * Parte de ganancia 0 y termina en 0: ni un click al entrar ni al salir.
 */
export function shapeEnvelope(p: AudioParam, t: number, dur: number, fadeIn: number, fadeOut: number, peak: number): void {
  const f = splitFades(dur, fadeIn, fadeOut);
  if (f.fadeIn > 0) p.setValueCurveAtTime(fadeCurve(curvePoints(f.fadeIn, 1500), 0, peak), t, f.fadeIn);
  else p.setValueAtTime(peak, t);
  if (f.fadeOut > 0) {
    const out = Math.max(t + f.fadeIn, t + dur - f.fadeOut);
    p.setValueCurveAtTime(fadeCurve(curvePoints(f.fadeOut, 1500), peak, 0), out, f.fadeOut);
  } else {
    p.setValueAtTime(0, t + dur);
  }
}
