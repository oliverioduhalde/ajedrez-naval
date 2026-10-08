/**
 * Coreografía pura: traduce un hecho de la partida (mover, atacar, mina) en una línea de tiempo de
 * sonidos y efectos visuales. No toca el DOM ni el audio: se puede probar con vitest.
 */
import { getCategory } from '../engine/pieces';
import type { Cell, Choreography, FxEvent, FxSpec, SoundCue } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Move = Extract<FxEvent, { kind: 'move' }>;
type Attack = Extract<FxEvent, { kind: 'attack' }>;
type MineBlast = Extract<FxEvent, { kind: 'mineBlast' }>;

function finish(sounds: SoundCue[], visuals: FxSpec[]): Choreography {
  let total = 0;
  for (const s of sounds) total = Math.max(total, s.at + (s.dur ?? 1600));
  for (const v of visuals) total = Math.max(total, v.at + v.dur);
  return { sounds, visuals, total };
}

/** Desplazamiento: el sonido depende del tipo de ficha. Solo si el espectador puede ver su identidad. */
export function planMove(ev: Move): Choreography {
  if (!ev.audible || ev.path.length === 0) return finish([], []);
  const steps = ev.path.length;
  const cap = (ms: number) => (ev.endsInBlast ? Math.min(ms, 520) : ms);
  const sounds: SoundCue[] = [];

  switch (ev.unit) {
    case 'Submarino':
      sounds.push({ at: 0, id: 'sonar', gain: 0.9 });
      if (steps >= 4 && !ev.endsInBlast) sounds.push({ at: 1500, id: 'sonar', gain: 0.55 });
      break;
    case 'AvionReconocimiento':
      sounds.push({ at: 0, id: 'reconMove', dur: cap(clamp(1100 + 300 * steps, 1300, 3600)) });
      break;
    case 'AvionCombate':
      sounds.push({ at: 0, id: 'fighterDive', dur: cap(clamp(1000 + 220 * steps, 1200, 2800)) });
      break;
    default:
      sounds.push({ at: 0, id: 'shipMove', dur: cap(clamp(1000 + 260 * steps, 1200, 3200)) });
  }
  return finish(sounds, []);
}

/** Qué se ve y se oye cuando una ficha ataca a otra. */
export function planAttack(ev: Attack): Choreography {
  const sounds: SoundCue[] = [];
  const visuals: FxSpec[] = [];
  const cat = getCategory(ev.attackerUnit);
  const targetCat = getCategory(ev.targetUnit);
  const fatal = ev.result === 'HUNDIDO' || ev.result === 'DERRIBADO';
  const damaged = ev.result === 'AVERIADO';
  const dist = Math.max(1, ev.distance);

  let impactAt: number;

  if (cat === 'submarino') {
    // sonar → lanzamiento del torpedo → recorrido → explosión
    const launch = 700;
    const flight = clamp(450 + 130 * dist, 600, 2000);
    impactAt = launch + flight;
    sounds.push({ at: 0, id: 'sonar', gain: 0.95 });
    sounds.push({ at: launch, id: 'torpedo', dur: flight + 250 });
    visuals.push({ type: 'torpedo', at: launch, dur: flight, from: ev.from, to: ev.to });
  } else if (cat === 'avion') {
    // picada + ráfaga de metralla
    const burstAt = 280;
    const burst = 720;
    impactAt = burstAt + burst - 60;
    sounds.push({ at: 0, id: 'fighterDive', dur: 1500, gain: 0.9 });
    sounds.push({ at: burstAt, id: 'machineGun', dur: burst });
    visuals.push({ type: 'muzzle', at: burstAt, dur: burst, cell: ev.from, toward: ev.to, weapon: 'gun' });
    visuals.push({ type: 'tracers', at: burstAt, dur: burst, from: ev.from, to: ev.to });
  } else {
    // cañonazo
    const flight = clamp(160 + 70 * dist, 220, 700);
    impactAt = flight;
    sounds.push({ at: 0, id: 'cannon', gain: 1 });
    visuals.push({ type: 'muzzle', at: 0, dur: 380, cell: ev.from, toward: ev.to, weapon: 'cannon' });
    visuals.push({ type: 'shell', at: 30, dur: flight - 30, from: ev.from, to: ev.to });
  }

  // La ficha destruida ya no está en el estado: se la dibuja hasta el impacto.
  if (fatal) {
    visuals.push({
      type: 'ghost', at: 0, dur: impactAt + 120,
      cell: ev.to, unit: ev.targetUnit, owner: ev.targetOwner, damaged: ev.targetWasDamaged,
    });
  }

  if (fatal || damaged) {
    const size: 'small' | 'medium' | 'large' =
      damaged ? 'medium' : targetCat === 'barco' ? 'large' : 'medium';
    visuals.push({ type: 'explosion', at: impactAt, dur: 1100, cell: ev.to, size });
    sounds.push({ at: impactAt, id: 'explosion', gain: size === 'large' ? 1.2 : size === 'medium' ? 0.9 : 0.6 });
    // Los barcos y submarinos levantan agua al ser alcanzados.
    if (targetCat !== 'avion' && (fatal || cat === 'submarino')) {
      visuals.push({ type: 'splash', at: impactAt + 80, dur: 1200, cell: ev.to, size: 'small' });
      sounds.push({ at: impactAt + 80, id: 'splashSmall', gain: 0.8 });
    }
  } else if (targetCat === 'avion') {
    // Disparo que no derriba: chispas / ráfaga de flak, sin sonido propio.
    visuals.push({ type: 'sparks', at: impactAt, dur: 600, cell: ev.to });
  } else if (cat === 'avion') {
    // La metralla rebota en el casco.
    visuals.push({ type: 'sparks', at: impactAt - 350, dur: 800, cell: ev.to });
  } else {
    // Proyectil o torpedo sin efecto: solo levanta agua.
    visuals.push({ type: 'splash', at: impactAt, dur: 1000, cell: ev.to, size: 'small' });
    sounds.push({ at: impactAt, id: 'splashSmall', gain: 0.9 });
  }

  return finish(sounds, visuals);
}

/** Una ficha entra a una casilla minada: explosión + splash grande. */
export function planMineBlast(ev: MineBlast): Choreography {
  const hit = 450;
  const visuals: FxSpec[] = [
    { type: 'ghost', at: 0, dur: hit + 120, cell: ev.at, unit: ev.unit, owner: ev.owner, damaged: ev.damaged },
    { type: 'explosion', at: hit, dur: 1200, cell: ev.at, size: 'large' },
    { type: 'splash', at: hit + 40, dur: 1700, cell: ev.at, size: 'big' },
  ];
  const sounds: SoundCue[] = [
    { at: hit, id: 'explosion', gain: 1.3 },
    { at: hit + 60, id: 'splash', gain: 1.1 },
  ];
  return finish(sounds, visuals);
}

export function planEvent(ev: FxEvent): Choreography {
  switch (ev.kind) {
    case 'move': return planMove(ev);
    case 'attack': return planAttack(ev);
    case 'mineBlast': return planMineBlast(ev);
  }
}

export function cellDistance(a: Cell, b: Cell): number {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}
