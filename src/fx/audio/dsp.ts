/**
 * Utilidades puras del motor de audio (sin Web Audio): envolventes, curvas, ruido y calendarios
 * aleatorios. Se prueban en Node con vitest.
 */

export type F32 = Float32Array<ArrayBuffer>;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

/** Generador pseudoaleatorio determinista (mulberry32) en [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- envolventes

export interface Fades {
  fadeIn: number;
  fadeOut: number;
  hold: number;
}

/** Reparte una duración en fade in + sostenido + fade out sin que los fades se pisen. */
export function splitFades(dur: number, fadeIn: number, fadeOut: number): Fades {
  let fi = Math.max(0, fadeIn);
  let fo = Math.max(0, fadeOut);
  const sum = fi + fo;
  if (sum > dur && sum > 0) {
    fi *= dur / sum;
    fo *= dur / sum;
  }
  return { fadeIn: fi, fadeOut: fo, hold: Math.max(0, dur - fi - fo) };
}

/** Puntos para una curva de `seconds` segundos, a razón de `perSecond` puntos por segundo. */
export function curvePoints(seconds: number, perSecond = 400): number {
  return clamp(Math.round(seconds * perSecond), 16, 2048);
}

/** Rampa de coseno elevado (arranca y llega con pendiente cero: sin clicks). */
export function fadeCurve(points: number, from: number, to: number): F32 {
  const n = Math.max(2, Math.round(points));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  return out;
}

/** Factor Doppler para un sobrevuelo: arranca en 1+depth (acercándose) y termina en 1-depth (alejándose). */
export function dopplerCurve(n: number, depth: number, centre = 0.5): F32 {
  const out = new Float32Array(Math.max(2, n));
  const k = 4;
  const norm = Math.tanh(k * Math.max(centre, 1 - centre));
  for (let i = 0; i < out.length; i++) {
    const x = i / (out.length - 1);
    out[i] = 1 - depth * (Math.tanh(k * (x - centre)) / norm);
  }
  return out;
}

/**
 * Curva de un limitador suave. La entrada de la curva (-1..1) equivale a ±`span` en la señal: lineal hasta
 * `knee`, y desde ahí se aplana tanh hacia `ceiling` sin llegar a un recorte duro (que con el sobremuestreo
 * del WaveShaper rebasaría el techo).
 */
export function softClipCurve(n = 2049, knee = 0.55, ceiling = 0.92, span = 2): F32 {
  const out = new Float32Array(n);
  const range = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = span * (-1 + (2 * i) / (n - 1));
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + range * Math.tanh((a - knee) / range);
    out[i] = x < 0 ? -y : y;
  }
  return out;
}

/** Tope duro en ±ceiling (sin sobremuestreo, así no hay rebasamiento): la red de seguridad tras el limitador suave. */
export function hardLimitCurve(n = 2001, ceiling = 0.945): F32 {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = clamp(-1 + (2 * i) / (n - 1), -ceiling, ceiling);
  return out;
}

/** Saturación suave tanh normalizada: salida en [-1, 1]. */
export function saturationCurve(n: number, drive: number): F32 {
  const out = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) out[i] = Math.tanh((drive * (-1 + (2 * i) / (n - 1)))) / norm;
  return out;
}

/** Valores aleatorios suavizados en [0, 1] (burbujeo, oleaje irregular). */
export function smoothRandom(n: number, rng: () => number, passes = 3): F32 {
  let cur = new Float32Array(n);
  for (let i = 0; i < n; i++) cur[i] = rng();
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) next[i] = (cur[Math.max(0, i - 1)] + cur[i] + cur[Math.min(n - 1, i + 1)]) / 3;
    cur = next;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of cur) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < n; i++) cur[i] = (cur[i] - lo) / span;
  return cur;
}

// ---------------------------------------------------------------- ruido y reverb

/** Cruza el final con el principio para que el buffer se pueda repetir sin salto. */
function loopable(data: Float32Array, length: number): F32 {
  const fade = data.length - length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    if (i < fade) {
      const w = i / fade;
      out[i] = data[i] * Math.sin((w * Math.PI) / 2) + data[length + i] * Math.cos((w * Math.PI) / 2);
    } else out[i] = data[i];
  }
  return out;
}

/** Ruido blanco uniforme, repetible sin salto, RMS ≈ 0,35. */
export function whiteNoise(length: number, rng: () => number): F32 {
  const raw = new Float32Array(length + 2048);
  for (let i = 0; i < raw.length; i++) raw[i] = (rng() * 2 - 1) * 0.6;
  return loopable(raw, length);
}

/** Ruido marrón (integral leaky del blanco), repetible sin salto, pico normalizado a 0,9. */
export function brownNoise(length: number, rng: () => number): F32 {
  const raw = new Float32Array(length + 4096);
  let y = 0;
  for (let i = 0; i < raw.length; i++) {
    y = (y + 0.02 * (rng() * 2 - 1)) / 1.02;
    raw[i] = y;
  }
  const out = loopable(raw, length);
  // una caminata aleatoria arrastra un nivel medio: se lo quita para que no entre corriente continua a los filtros
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] -= mean;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const k = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/**
 * Respuesta al impulso estéreo de una sala/mar abierto: ruido con decaimiento exponencial que se
 * oscurece con el tiempo, unas primeras reflexiones y una cola que llega a cero exacto, de energía unitaria.
 */
export function impulseResponse(sampleRate: number, seconds: number, rng: () => number): [F32, F32] {
  const n = Math.floor(sampleRate * seconds);
  const tau = seconds / 8.4; // -73 dB al final
  const early = [0.011, 0.017, 0.029, 0.041, 0.057];
  const channels: F32[] = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const a = lerp(0.8, 0.07, Math.min(1, t / seconds)); // coeficiente del pasa-bajos: cada vez más oscuro
      const x = (rng() * 2 - 1) * Math.exp(-t / tau);
      lp += a * (x - lp);
      const rise = Math.min(1, t / 0.014); // sin golpe seco al arrancar
      d[i] = lp * rise;
    }
    for (let k = 0; k < early.length; k++) {
      const at = Math.floor((early[k] + ch * 0.0013) * sampleRate);
      if (at < n) d[at] += (k % 2 ? -1 : 1) * 0.5 * Math.pow(0.72, k);
    }
    const tailStart = Math.floor(n * 0.78);
    for (let i = tailStart; i < n; i++) d[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - tailStart)) / (n - tailStart));
    d[n - 1] = 0;
    // energía unitaria por canal: la reverb devuelve tanta energía como recibe, igual en todos los navegadores
    let energy = 0;
    for (let i = 0; i < n; i++) energy += d[i] * d[i];
    const k = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    for (let i = 0; i < n; i++) d[i] *= k;
    channels.push(d);
  }
  return [channels[0], channels[1]];
}

// ---------------------------------------------------------------- calendarios de eventos

/**
 * Instantes de los disparos de una ráfaga dentro de [0, span): `rate` por segundo con una variación
 * leve de periodo. Nunca quedan dos a menos de 45 ms (cada disparo necesita su espacio).
 */
export function shotTimes(span: number, rate: number, rng: () => number, jitter = 0.3): number[] {
  const period = 1 / rate;
  const out: number[] = [];
  for (let t = 0; t < span; t += period) {
    const at = t + (rng() - 0.5) * period * jitter;
    const prev = out.length ? out[out.length - 1] : -Infinity;
    const clamped = Math.max(0, at, prev + 0.045);
    if (clamped < span) out.push(clamped);
  }
  return out;
}

/** Instantes de burbujas dentro de [0, span]: cada vez más escasas (densidad decreciente). */
export function bubbleTimes(count: number, span: number, rng: () => number, from = 0.03): number[] {
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push(from + (span - from) * Math.pow((k + rng() * 0.8) / count, 1.7));
  return out.sort((a, b) => a - b);
}

/** Instantes de clicks de crepitar dentro de [from, span]: más densos al principio, a más de 4 ms entre sí. */
export function crackleTimes(count: number, span: number, rng: () => number, from = 0.04): number[] {
  const raw: number[] = [];
  for (let k = 0; k < count; k++) raw.push(from + (span - from) * Math.pow(rng(), 1.8));
  raw.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of raw) if (!out.length || t >= out[out.length - 1] + 0.004) out.push(t);
  return out;
}
