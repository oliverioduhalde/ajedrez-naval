export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Entero uniforme en [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function shuffleInPlace<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  return shuffleInPlace(arr.slice(), rng);
}

/** Indice elegido con probabilidad proporcional a weights[i] (pesos >= 0). */
export function pickWeighted(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return Math.floor(rng() * weights.length);
  let x = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x < 0) return i;
  }
  return weights.length - 1;
}

export const HASH_SEED = 0x9747b28c;

/** Mezcla un entero de 32 bits en un hash corriente (variante murmur3). */
export function mixHash(h: number, x: number): number {
  let k = Math.imul(x | 0, 0xcc9e2d51);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, 0x1b873593);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

export function finishHash(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(s: string, h: number = HASH_SEED): number {
  for (let i = 0; i < s.length; i++) h = mixHash(h, s.charCodeAt(i));
  return h;
}

/** Semilla de 32 bits a partir de numeros y/o textos. */
export function seedFrom(...parts: (number | string)[]): number {
  let h = HASH_SEED;
  for (const p of parts) h = typeof p === 'number' ? mixHash(h, p) : hashString(p, h);
  return finishHash(h);
}
