/**
 * Las diez voces sintetizadas. Cada `build` crea sus nodos en el `Rack` y los conecta a `out`: la
 * envolvente general (fade in / fade out) y el envío a la reverb los pone `graph.ts`, así que acá solo
 * se diseña el timbre. `t` es el instante de arranque en el reloj del contexto.
 */
import type { SoundId } from '../types';
import { glide, followCurve, shapeEnvelope, strike } from './automation';
import {
  bubbleTimes, clamp, crackleTimes, curvePoints, dopplerCurve, lerp, saturationCurve, shotTimes, smoothRandom,
} from './dsp';
import type { Rack } from './rack';

export interface VoiceArgs {
  r: Rack;
  out: AudioNode;
  /** instante de arranque (s, reloj del contexto) */
  t: number;
  /** duración total de la voz (s) */
  dur: number;
  /** volumen relativo pedido por quien llama */
  gain: number;
}

export interface VoiceDef {
  label: string;
  blurb: string;
  defaultDur: number;
  /** duración fija en s: ignora opts.dur */
  fixed?: number;
  minDur: number;
  maxDur: number;
  fadeIn: (dur: number) => number;
  fadeOut: (dur: number) => number;
  /** nivel nominal del bus de la voz (equilibrio entre sonidos) */
  level: number;
  /** cuánto de la voz va a la reverb */
  wet: number;
  /** segundos que sigue sonando la reverb después de la voz (para renderizar offline) */
  tail: number;
  build: (v: VoiceArgs) => void;
}

// ------------------------------------------------------------------ 1. sonar

/** Un ping: seno con FM metálica que se calma, ataque de 8 ms y decaimiento exponencial. */
function ping(r: Rack, dest: AudioNode, t: number, level: number, metal: number): void {
  const f = 1400;
  const car = r.osc('sine', f, t, t + 2);
  const mod = r.osc('sine', f * 1.4142, t, t + 2);
  const dev = r.gain(0);
  dev.gain.setValueAtTime(650 * metal, t);
  dev.gain.setTargetAtTime(30, t, 0.07);
  mod.connect(dev);
  dev.connect(car.frequency);
  const env = r.gain(0);
  strike(env.gain, t, level, 0.008, 0.17);
  r.chain(car, env, dest);
}

function buildSonar({ r, out, t }: VoiceArgs): void {
  const water = r.filter('lowpass', 3600, 0.6); // sensación submarina
  water.connect(out);
  ping(r, water, t, 1, 1);
  const echo1 = r.filter('lowpass', 2500, 0.5);
  echo1.connect(water);
  ping(r, echo1, t + 0.45, 0.42, 0.45);
  const echo2 = r.filter('lowpass', 1600, 0.5);
  echo2.connect(water);
  ping(r, echo2, t + 0.95, 0.18, 0.2);

  // resonancia del casco: golpe sordo a ~700 Hz que se apaga enseguida
  const hull = r.osc('sine', 702, t, t + 1.4);
  const hullEnv = r.gain(0);
  strike(hullEnv.gain, t, 0.17, 0.03, 0.2);
  r.chain(hull, hullEnv, water);
  const knock = r.noise('white', t, t + 0.25);
  const knockBand = r.filter('bandpass', 700, 7);
  const knockEnv = r.gain(0);
  strike(knockEnv.gain, t, 0.9, 0.002, 0.016);
  r.chain(knock, knockBand, knockEnv, water);
}

// ------------------------------------------------------------------ 2. barco en marcha

/** Perfil 0..1 de la ola: crece hasta ~55 % del recorrido y se calma. */
function swellProfile(x: number): number {
  return x < 0.55 ? Math.pow(Math.sin((Math.PI / 2) * (x / 0.55)), 1.4) : 0.4 + 0.6 * Math.cos((Math.PI / 2) * ((x - 0.55) / 0.45));
}

function buildShipMove({ r, out, t, dur }: VoiceArgs): void {
  const end = t + dur;

  // motor diésel: sierra grave con vibrato lento y golpeteo de pistones
  const saw = r.osc('sawtooth', 50, t, end);
  const wobble = r.osc('sine', 0.45, t, end);
  const wobbleDepth = r.gain(0.9);
  r.chain(wobble, wobbleDepth, saw.frequency);
  const grit = r.shaper(saturationCurve(1024, 2.2));
  const engineBody = r.filter('lowpass', 300, 0.9);
  const chug = r.gain(0.74);
  const chugLfo = r.osc('sine', 6.5, t, end);
  const chugDepth = r.gain(0.26);
  r.chain(chugLfo, chugDepth, chug.gain);
  const engine = r.gain(0.7);
  r.chain(saw, grit, engineBody, chug, engine, out);

  // sub con latido lento (36 y 38,5 Hz → 2,5 Hz)
  const subMix = r.gain(0.22);
  for (const f of [36, 38.5]) r.chain(r.osc('sine', f, t, end), subMix);
  subMix.connect(out);

  // retumbo: ruido marrón pasa-bajos
  const rumble = r.filter('lowpass', 200, 0.7);
  const rumbleGain = r.gain(0.85);
  r.chain(r.noise('brown', t, end), rumble, rumbleGain, out);

  // oleaje contra el casco: ruido pasa-banda que crece y se calma
  const n = curvePoints(dur, 40);
  const band = new Float32Array(n);
  const level = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const s = swellProfile(x);
    band[i] = lerp(500, 1400, s);
    level[i] = 0.6 * s * (1 + 0.28 * Math.sin(2 * Math.PI * 0.9 * x * dur + 1.3));
  }
  const waves = r.filter('bandpass', 500, 0.8);
  const waveGain = r.gain(0);
  waves.frequency.setValueCurveAtTime(band, t, dur);
  waveGain.gain.setValueCurveAtTime(level, t, dur);
  r.chain(r.noise('white', t, end), waves, waveGain, out);
}

// ------------------------------------------------------------------ 3. avión de reconocimiento

function buildReconMove({ r, out, t, dur }: VoiceArgs): void {
  const end = t + dur;
  const doppler = dopplerCurve(curvePoints(dur, 60), 0.03);
  const mix = r.filter('lowpass', 520, 2.2);
  const trim = r.gain(0.62);
  r.chain(mix, trim, out);

  // dos motores desafinados (batido de 4 Hz), cada uno con su hélice (20 y 24 Hz)
  for (const [freq, blades] of [[90, 20.5], [94, 24]] as const) {
    const saw = r.osc('sawtooth', freq, t, end);
    followCurve(saw.frequency, t, dur, freq, doppler);
    const prop = r.gain(0.62);
    const chop = r.osc('sine', blades, t, end);
    followCurve(chop.frequency, t, dur, blades, doppler);
    const depth = r.gain(0.38);
    r.chain(chop, depth, prop.gain);
    r.chain(saw, prop, mix);
  }

  // aire alrededor de la cabina
  const air = r.filter('bandpass', 300, 1.1);
  const airGain = r.gain(0.5);
  r.chain(r.noise('white', t, end), air, airGain, out);
}

// ------------------------------------------------------------------ 4. caza en picada

function buildFighterDive({ r, out, t, dur }: VoiceArgs): void {
  const end = t + dur;
  const f0 = 250;
  const f1 = 1200;

  // chillido de motor/hélice: sierra que sube en barrido exponencial, saturada
  const saw = r.osc('sawtooth', f0, t, end);
  glide(saw.frequency, t, f0, f1, dur);
  const sat = r.shaper(saturationCurve(1024, 2.6));
  const prop = r.gain(0.55);
  const chop = r.osc('sine', 25, t, end);
  glide(chop.frequency, t, 25, 60, dur); // la hélice gira cada vez más rápido
  const chopDepth = r.gain(0.45);
  r.chain(chop, chopDepth, prop.gain);
  r.chain(saw, sat, prop);

  const body = r.filter('lowpass', 3000, 0.7);
  r.chain(prop, body, r.gain(0.5), out);

  // formante que acompaña el barrido
  const formant = r.filter('bandpass', f0 * 1.7, 5);
  glide(formant.frequency, t, f0 * 1.7, f1 * 1.7, dur);
  r.chain(prop, formant, r.gain(1.1), out);

  // viento agudo que crece
  const wind = r.filter('bandpass', 1500, 0.8);
  glide(wind.frequency, t, 1500, 4500, dur);
  const windGain = r.gain(0);
  glide(windGain.gain, t, 0.03, 0.5, dur);
  r.chain(r.noise('white', t, end), wind, windGain, out);
}

// ------------------------------------------------------------------ 5. cañonazo

function buildCannon({ r, out, t }: VoiceArgs): void {
  // transitorio de ruido
  const crack = r.filter('highpass', 500, 0.7);
  const crackEnv = r.gain(0);
  strike(crackEnv.gain, t, 1, 0.001, 0.011);
  r.chain(r.noise('white', t, t + 0.12), crack, crackEnv, out);

  // golpe grave
  const thump = r.osc('sine', 150, t, t + 0.55);
  glide(thump.frequency, t, 150, 45, 0.2);
  const thumpEnv = r.gain(0);
  strike(thumpEnv.gain, t, 1, 0.003, 0.09);
  r.chain(thump, thumpEnv, out);

  // retumbo y eco lejano (más grave, más blando, a 0,3 s)
  const rolls: [number, number, number][] = [[0, 1, 1000], [0.3, 0.3, 520]];
  for (const [delay, level, top] of rolls) {
    const ts = t + delay;
    const low = r.filter('lowpass', top, 0.7);
    glide(low.frequency, ts, top, 140, 1);
    const env = r.gain(0);
    strike(env.gain, ts, level, 0.012, 0.3);
    r.chain(r.noise('brown', ts, ts + 1.4), low, env, out);
  }
  const echoThump = r.osc('sine', 110, t + 0.3, t + 0.8);
  glide(echoThump.frequency, t + 0.3, 110, 40, 0.22);
  const echoEnv = r.gain(0);
  strike(echoEnv.gain, t + 0.3, 0.3, 0.006, 0.1);
  r.chain(echoThump, echoEnv, out);
}

// ------------------------------------------------------------------ 6. torpedo

function buildTorpedo({ r, out, t, dur }: VoiceArgs): void {
  const end = t + dur;

  // lanzamiento neumático: golpe sordo y soplido de aire comprimido
  const thump = r.osc('sine', 90, t, t + 0.4);
  glide(thump.frequency, t, 90, 50, 0.16);
  const thumpEnv = r.gain(0);
  strike(thumpEnv.gain, t, 1, 0.004, 0.07);
  r.chain(thump, thumpEnv, out);
  const blow = r.filter('bandpass', 1700, 0.6);
  const blowEnv = r.gain(0);
  strike(blowEnv.gain, t, 0.5, 0.01, 0.13);
  r.chain(r.noise('white', t, t + 0.6), blow, blowEnv, out);

  // recorrido: hélice que acelera + burbujeo, con su propia entrada (12 %) y salida (25 %)
  const run = r.gain(0);
  shapeEnvelope(run.gain, t, dur, dur * 0.12, dur * 0.25, 1);
  const water = r.filter('lowpass', 4000, 0.5);
  r.chain(water, run, out);

  const prop = r.osc('sawtooth', 70, t, end);
  glide(prop.frequency, t, 70, 95, dur);
  const chop = r.osc('sine', 11, t, end);
  glide(chop.frequency, t, 11, 14, dur);
  const am = r.gain(0.6);
  const chopDepth = r.gain(0.4);
  r.chain(chop, chopDepth, am.gain);
  const propBody = r.filter('lowpass', 350, 1.2);
  r.chain(prop, am, propBody, r.gain(0.9), water);

  const bubbles = r.filter('bandpass', 1000, 2);
  const bubbleGain = r.gain(0);
  bubbleGain.gain.setValueCurveAtTime(smoothRandom(curvePoints(dur, 30), r.rng, 2).map(v => 0.3 + 2.2 * v), t, dur);
  r.chain(r.noise('white', t, end), bubbles, bubbleGain, water);
}

// ------------------------------------------------------------------ 7. ametralladora

function buildMachineGun({ r, out, t, dur }: VoiceArgs): void {
  const end = t + dur;
  const rate = 13 + r.rng() * 2;
  const shots = shotTimes(Math.max(0, dur - 0.06), rate, r.rng);

  // un solo ruido y un solo seno, con la envolvente de cada disparo automatizada
  const hp = r.filter('highpass', 1800, 0.7);
  const snap = r.gain(0);
  r.chain(r.noise('white', t, end), hp, snap, out);
  const kick = r.osc('sine', 120, t, end);
  const kickEnv = r.gain(0);
  r.chain(kick, kickEnv, out);

  for (const s of shots) {
    const ts = t + 0.02 + s;
    const a = 0.75 + r.rng() * 0.25;
    const f = 120 * (0.92 + 0.16 * r.rng());
    snap.gain.setValueAtTime(0, ts);
    snap.gain.linearRampToValueAtTime(1.3 * a, ts + 0.0015);
    snap.gain.setTargetAtTime(0, ts + 0.0015, 0.007);
    kick.frequency.setValueAtTime(f * 1.25, ts);
    kick.frequency.exponentialRampToValueAtTime(f * 0.7, ts + 0.04);
    kickEnv.gain.setValueAtTime(0, ts);
    kickEnv.gain.linearRampToValueAtTime(0.5 * a, ts + 0.002);
    kickEnv.gain.setTargetAtTime(0, ts + 0.002, 0.011);
  }
}

// ------------------------------------------------------------------ 8. explosión

function buildExplosion({ r, out, t, gain }: VoiceArgs): void {
  const bass = clamp(0.55 + 0.5 * gain, 0.5, 1.4);
  const open = 2600 + 900 * clamp(gain, 0.3, 1.5);

  // chasquido inicial
  const snap = r.filter('highpass', 2500, 0.7);
  const snapEnv = r.gain(0);
  strike(snapEnv.gain, t, 1, 0.001, 0.008);
  r.chain(r.noise('white', t, t + 0.1), snap, snapEnv, out);

  // cuerpo: ruido cuyo pasa-bajos se cierra de golpe
  const body = r.filter('lowpass', open, 0.9);
  glide(body.frequency, t, open, 120, 1.1);
  const bodyEnv = r.gain(0);
  strike(bodyEnv.gain, t, 1.6, 0.008, 0.36);
  r.chain(r.noise('white', t, t + 1.9), body, bodyEnv, out);

  // bombo sub (70 → 28 Hz), con un poco de saturación para que se oiga en parlantes chicos
  const sub = r.osc('sine', 70, t, t + 1.8);
  glide(sub.frequency, t, 70, 28, 1.2);
  const warm = r.shaper(saturationCurve(1024, 1.7));
  const subEnv = r.gain(0);
  strike(subEnv.gain, t, 0.9 * bass, 0.006, 0.42);
  r.chain(sub, warm, subEnv, out);

  // retumbo marrón
  const rumble = r.filter('lowpass', 170, 0.7);
  const rumbleEnv = r.gain(0);
  strike(rumbleEnv.gain, t, 0.9 * bass, 0.02, 0.55);
  r.chain(r.noise('brown', t, t + 2.2), rumble, rumbleEnv, out);

  // crepitar de escombros
  const crackle = r.filter('bandpass', 2800, 1.1);
  const crackleEnv = r.gain(0);
  r.chain(r.noise('white', t, t + 1.4), crackle, crackleEnv, out);
  for (const c of crackleTimes(46, 1.2, r.rng)) {
    const ts = t + c;
    const a = 0.55 * (1 - c / 1.4) * (0.4 + 0.6 * r.rng());
    crackleEnv.gain.setValueAtTime(0, ts);
    crackleEnv.gain.linearRampToValueAtTime(a, ts + 0.0015);
    crackleEnv.gain.setTargetAtTime(0, ts + 0.0015, 0.006);
  }
}

// ------------------------------------------------------------------ 9 y 10. splash

interface SplashShape {
  bandFrom: number;
  bandTo: number;
  swell: number;
  tau: number;
  sweep: number;
  thumpHz: number;
  thump: number;
  bubbles: number;
  bubbleSpan: number;
  bubbleLevel: number;
  noiseLevel: number;
}

const BIG_SPLASH: SplashShape = {
  bandFrom: 500, bandTo: 2500, swell: 0.15, tau: 0.42, sweep: 1.2,
  thumpHz: 80, thump: 0.8, bubbles: 12, bubbleSpan: 1.35, bubbleLevel: 0.2, noiseLevel: 1,
};
const SMALL_SPLASH: SplashShape = {
  bandFrom: 800, bandTo: 3000, swell: 0.05, tau: 0.16, sweep: 0.5,
  thumpHz: 120, thump: 0.3, bubbles: 4, bubbleSpan: 0.4, bubbleLevel: 0.14, noiseLevel: 0.7,
};

function buildSplash({ r, out, t }: VoiceArgs, s: SplashShape): void {
  // chorro de agua: ruido pasa-banda que se abre y se apaga
  const band = r.filter('bandpass', s.bandFrom, 0.9);
  glide(band.frequency, t, s.bandFrom, s.bandTo, s.sweep);
  const spray = r.gain(0);
  const swellSteps = 24;
  spray.gain.setValueCurveAtTime(
    Float32Array.from({ length: swellSteps }, (_, i) => s.noiseLevel * (0.5 - 0.5 * Math.cos((Math.PI * i) / (swellSteps - 1)))),
    t, s.swell,
  );
  spray.gain.setTargetAtTime(0, t + s.swell, s.tau);
  r.chain(r.noise('white', t, t + s.swell + s.tau * 7), band, spray, out);

  // golpe grave del agua al cerrarse
  const thump = r.osc('sine', s.thumpHz, t, t + 0.6);
  glide(thump.frequency, t, s.thumpHz * 1.15, s.thumpHz * 0.7, 0.2);
  const thumpEnv = r.gain(0);
  strike(thumpEnv.gain, t, s.thump, 0.006, 0.12);
  r.chain(thump, thumpEnv, out);

  // burbujas: senos con glissando ascendente, cada vez más escasas
  const times = bubbleTimes(s.bubbles, s.bubbleSpan, r.rng, 0.05);
  times.forEach((bt, k) => {
    const ts = t + bt;
    const f0 = 400 + r.rng() * 700;
    const f1 = Math.min(1800, f0 * (1.5 + r.rng() * 0.6));
    const life = 0.04 + r.rng() * 0.03;
    const o = r.osc('sine', f0, ts, ts + 0.3);
    glide(o.frequency, ts, f0, f1, life);
    const env = r.gain(0);
    strike(env.gain, ts, s.bubbleLevel * (1 - 0.5 * (k / times.length)), 0.004, 0.03);
    r.chain(o, env, out);
  });
}

// ------------------------------------------------------------------ tabla

export const SOUND_IDS: readonly SoundId[] = [
  'sonar', 'shipMove', 'reconMove', 'fighterDive', 'cannon', 'torpedo', 'machineGun', 'explosion', 'splash', 'splashSmall',
];

export const VOICES: Record<SoundId, VoiceDef> = {
  sonar: {
    label: 'Sonar del submarino', blurb: 'Ping metálico bajo el agua, con dos ecos que se apagan.',
    defaultDur: 2.3, fixed: 2.3, minDur: 2.3, maxDur: 2.3,
    fadeIn: () => 0.006, fadeOut: () => 0.45, level: 0.8, wet: 0.35, tail: 1.4, build: buildSonar,
  },
  shipMove: {
    label: 'Barco en marcha', blurb: 'Motor diésel grave y oleaje contra el casco.',
    defaultDur: 2.2, minDur: 0.4, maxDur: 8,
    fadeIn: d => d * 0.35, fadeOut: d => d * 0.4, level: 0.6, wet: 0.08, tail: 0.5, build: buildShipMove,
  },
  reconMove: {
    label: 'Avión de reconocimiento', blurb: 'Bimotor de hélices dobles, grave, pasando de largo.',
    defaultDur: 2.6, minDur: 0.4, maxDur: 8,
    fadeIn: d => d * 0.35, fadeOut: d => d * 0.35, level: 0.6, wet: 0.1, tail: 0.5, build: buildReconMove,
  },
  fighterDive: {
    label: 'Caza en picada', blurb: 'Chillido de motor y hélice que sube, al estilo de la 2ª guerra.',
    defaultDur: 1.8, minDur: 0.4, maxDur: 8,
    fadeIn: d => d * 0.25, fadeOut: d => d * 0.35, level: 0.55, wet: 0.12, tail: 0.5, build: buildFighterDive,
  },
  cannon: {
    label: 'Cañonazo', blurb: 'Disparo de buque: estampido, golpe grave y eco lejano.',
    defaultDur: 1.6, fixed: 1.6, minDur: 1.6, maxDur: 1.6,
    fadeIn: () => 0.004, fadeOut: () => 0.4, level: 0.85, wet: 0.4, tail: 1.4, build: buildCannon,
  },
  torpedo: {
    label: 'Torpedo', blurb: 'Lanzamiento neumático y recorrido submarino con hélice y burbujas.',
    defaultDur: 1.8, minDur: 0.6, maxDur: 8,
    fadeIn: () => 0.005, fadeOut: d => d * 0.25, level: 0.6, wet: 0.15, tail: 0.8, build: buildTorpedo,
  },
  machineGun: {
    label: 'Metralla', blurb: 'Ráfaga de ametralladora de caza, unos 14 disparos por segundo.',
    defaultDur: 0.8, minDur: 0.3, maxDur: 4,
    fadeIn: d => Math.min(0.09, d * 0.12), fadeOut: d => Math.min(0.18, d * 0.25), level: 0.95, wet: 0.12, tail: 0.8, build: buildMachineGun,
  },
  explosion: {
    label: 'Explosión', blurb: 'Estallido con chasquido, bombo sub, retumbo y escombros.',
    defaultDur: 2.6, fixed: 2.6, minDur: 2.6, maxDur: 2.6,
    fadeIn: () => 0.004, fadeOut: () => 0.55, level: 0.8, wet: 0.5, tail: 1.5, build: buildExplosion,
  },
  splash: {
    label: 'Splash grande', blurb: 'Columna de agua que cae con burbujas, como una mina al estallar.',
    defaultDur: 1.8, fixed: 1.8, minDur: 1.8, maxDur: 1.8,
    fadeIn: () => 0.004, fadeOut: () => 0.5, level: 1.1, wet: 0.3, tail: 1.2, build: v => buildSplash(v, BIG_SPLASH),
  },
  splashSmall: {
    label: 'Chapoteo', blurb: 'Salpicadura corta y suave de un impacto en el agua.',
    defaultDur: 0.7, fixed: 0.7, minDur: 0.7, maxDur: 0.7,
    fadeIn: () => 0.004, fadeOut: () => 0.2, level: 1.0, wet: 0.2, tail: 0.8, build: v => buildSplash(v, SMALL_SPLASH),
  },
};
