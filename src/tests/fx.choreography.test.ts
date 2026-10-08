import { describe, expect, it } from 'vitest';
import { planAttack, planEvent, planMineBlast, planMove } from '../fx/choreography';
import type { Choreography, FxEvent, SoundId } from '../fx/types';

type Attack = Extract<FxEvent, { kind: 'attack' }>;
type Move = Extract<FxEvent, { kind: 'move' }>;

const ALL_SOUNDS: SoundId[] = [
  'sonar', 'shipMove', 'reconMove', 'fighterDive', 'cannon', 'torpedo', 'machineGun', 'explosion', 'splash', 'splashSmall',
];

function attack(over: Partial<Attack> = {}): Attack {
  return {
    kind: 'attack',
    attackerId: 'A-Acorazado-0', attackerUnit: 'Acorazado', attackerOwner: 'A', from: { r: 10, c: 5 },
    targetId: 'B-Crucero-0', targetUnit: 'Crucero', targetOwner: 'B', to: { r: 10, c: 9 },
    distance: 4, result: 'HUNDIDO', targetWasDamaged: false,
    ...over,
  };
}

function move(over: Partial<Move> = {}): Move {
  return {
    kind: 'move', pieceId: 'A-Fragata-0', unit: 'Fragata', owner: 'A',
    from: { r: 10, c: 5 }, path: [{ r: 10, c: 6 }, { r: 10, c: 7 }], audible: true,
    ...over,
  };
}

const ids = (c: Choreography) => c.sounds.map(s => s.id);
const types = (c: Choreography) => c.visuals.map(v => v.type);
const soundAt = (c: Choreography, id: SoundId) => c.sounds.find(s => s.id === id)!;

function expectWellFormed(c: Choreography) {
  for (const s of c.sounds) {
    expect(ALL_SOUNDS).toContain(s.id);
    expect(s.at).toBeGreaterThanOrEqual(0);
    if (s.dur !== undefined) expect(s.dur).toBeGreaterThan(0);
    expect(c.total).toBeGreaterThanOrEqual(s.at);
  }
  for (const v of c.visuals) {
    expect(v.at).toBeGreaterThanOrEqual(0);
    expect(v.dur).toBeGreaterThan(0);
    expect(c.total).toBeGreaterThanOrEqual(v.at + v.dur);
  }
}

describe('coreografía de desplazamiento', () => {
  it('cada tipo de ficha suena distinto', () => {
    expect(ids(planMove(move({ unit: 'Submarino' })))).toEqual(['sonar']);
    expect(ids(planMove(move({ unit: 'AvionReconocimiento' })))).toEqual(['reconMove']);
    expect(ids(planMove(move({ unit: 'AvionCombate' })))).toEqual(['fighterDive']);
    for (const unit of ['Acorazado', 'Crucero', 'Fragata', 'Minador'] as const) {
      expect(ids(planMove(move({ unit })))).toEqual(['shipMove']);
    }
  });

  it('niebla de guerra: una ficha cuya identidad no se ve no suena', () => {
    const c = planMove(move({ audible: false, unit: 'Submarino' }));
    expect(c.sounds).toEqual([]);
    expect(c.visuals).toEqual([]);
  });

  it('el sonido dura más cuanto más lejos va, con tope', () => {
    const short = soundAt(planMove(move({ path: [{ r: 1, c: 1 }] })), 'shipMove').dur!;
    const long = soundAt(planMove(move({ path: Array.from({ length: 6 }, (_, i) => ({ r: 1, c: i + 1 })) })), 'shipMove').dur!;
    const huge = soundAt(planMove(move({ path: Array.from({ length: 30 }, (_, i) => ({ r: 1, c: i + 1 })) })), 'shipMove').dur!;
    expect(long).toBeGreaterThan(short);
    expect(huge).toBeLessThanOrEqual(3200);
  });

  it('un submarino que va lejos repite el ping', () => {
    const far = planMove(move({ unit: 'Submarino', path: Array.from({ length: 5 }, (_, i) => ({ r: 1, c: i + 1 })) }));
    expect(ids(far)).toEqual(['sonar', 'sonar']);
  });

  it('si la ficha muere en una mina al final, el sonido se corta antes', () => {
    const path = Array.from({ length: 8 }, (_, i) => ({ r: 1, c: i + 1 }));
    const normal = soundAt(planMove(move({ path })), 'shipMove').dur!;
    const cut = soundAt(planMove(move({ path, endsInBlast: true })), 'shipMove').dur!;
    expect(cut).toBeLessThan(normal);
    expect(cut).toBeLessThanOrEqual(520);
  });

  it('sin recorrido no hay nada', () => {
    expect(planMove(move({ path: [] })).sounds).toEqual([]);
  });
});

describe('coreografía de ataque', () => {
  it('barco → barco: cañonazo, proyectil y luego explosión grande con la ficha fantasma hasta el impacto', () => {
    const c = planAttack(attack());
    expectWellFormed(c);
    expect(ids(c)[0]).toBe('cannon');
    expect(soundAt(c, 'cannon').at).toBe(0);
    const boom = soundAt(c, 'explosion');
    expect(boom.at).toBeGreaterThan(0);
    expect(types(c)).toEqual(expect.arrayContaining(['muzzle', 'shell', 'ghost', 'explosion']));
    const ghost = c.visuals.find(v => v.type === 'ghost')!;
    expect(ghost.at + ghost.dur).toBeGreaterThan(boom.at);
    const fire = c.visuals.find(v => v.type === 'explosion')!;
    expect(fire.type === 'explosion' && fire.size).toBe('large');
    expect(fire.at).toBe(boom.at);
  });

  it('el proyectil tarda más cuanto más lejos está el blanco', () => {
    const near = soundAt(planAttack(attack({ distance: 1 })), 'explosion').at;
    const far = soundAt(planAttack(attack({ distance: 6 })), 'explosion').at;
    expect(far).toBeGreaterThan(near);
  });

  it('AVERIADO: explosión mediana sin fantasma (la ficha sigue en el tablero)', () => {
    const c = planAttack(attack({ result: 'AVERIADO' }));
    expect(types(c)).not.toContain('ghost');
    const fire = c.visuals.find(v => v.type === 'explosion')!;
    expect(fire.type === 'explosion' && fire.size).toBe('medium');
  });

  it('submarino: sonar → torpedo → explosión, en ese orden', () => {
    const c = planAttack(attack({ attackerUnit: 'Submarino', result: 'HUNDIDO' }));
    expectWellFormed(c);
    expect(ids(c).slice(0, 2)).toEqual(['sonar', 'torpedo']);
    expect(soundAt(c, 'sonar').at).toBeLessThan(soundAt(c, 'torpedo').at);
    expect(soundAt(c, 'torpedo').at).toBeLessThan(soundAt(c, 'explosion').at);
    expect(types(c)).toContain('torpedo');
    expect(types(c)).not.toContain('shell');
  });

  it('caza: picada + ametralladora + trazadoras, y explosión si derriba', () => {
    const c = planAttack(attack({ attackerUnit: 'AvionCombate', targetUnit: 'AvionReconocimiento', result: 'DERRIBADO' }));
    expectWellFormed(c);
    expect(ids(c)).toEqual(expect.arrayContaining(['fighterDive', 'machineGun', 'explosion']));
    expect(types(c)).toEqual(expect.arrayContaining(['tracers', 'muzzle', 'ghost', 'explosion']));
    // un avión derribado no levanta agua
    expect(types(c)).not.toContain('splash');
  });

  it('caza contra barco (ILESO): chispas, sin explosión', () => {
    const c = planAttack(attack({ attackerUnit: 'AvionCombate', result: 'ILESO' }));
    expect(types(c)).toContain('sparks');
    expect(types(c)).not.toContain('explosion');
    expect(ids(c)).not.toContain('explosion');
  });

  it('proyectil que no daña a un submarino: solo agua', () => {
    const c = planAttack(attack({ targetUnit: 'Submarino', result: 'ILESO' }));
    expect(types(c)).toContain('splash');
    expect(types(c)).not.toContain('explosion');
    expect(ids(c)).toContain('splashSmall');
  });

  it('tiro al aire que no derriba: sin sonido de agua', () => {
    const c = planAttack(attack({ targetUnit: 'AvionCombate', result: 'ILESO' }));
    expect(types(c)).toContain('sparks');
    expect(ids(c)).not.toContain('splashSmall');
  });

  it('todas las combinaciones tipo×resultado producen líneas de tiempo válidas', () => {
    const units = ['Acorazado', 'Crucero', 'Fragata', 'Minador', 'Submarino', 'AvionCombate', 'AvionReconocimiento'] as const;
    const results = ['HUNDIDO', 'DERRIBADO', 'AVERIADO', 'ILESO', 'ILESA'] as const;
    for (const attackerUnit of units) for (const targetUnit of units) for (const result of results) {
      for (const distance of [1, 3, 8]) {
        expectWellFormed(planAttack(attack({ attackerUnit, targetUnit, result, distance })));
      }
    }
  });
});

describe('coreografía de mina', () => {
  it('explosión grande y splash grande, con la ficha visible hasta que estalla', () => {
    const c = planMineBlast({ kind: 'mineBlast', pieceId: 'A-Fragata-0', unit: 'Fragata', owner: 'A', at: { r: 10, c: 10 }, damaged: false });
    expectWellFormed(c);
    expect(ids(c)).toEqual(['explosion', 'splash']);
    const splash = c.visuals.find(v => v.type === 'splash')!;
    expect(splash.type === 'splash' && splash.size).toBe('big');
    const ghost = c.visuals.find(v => v.type === 'ghost')!;
    expect(ghost.at + ghost.dur).toBeGreaterThan(soundAt(c, 'explosion').at);
  });

  it('planEvent despacha por tipo de hecho', () => {
    expect(ids(planEvent(move()))).toEqual(['shipMove']);
    expect(ids(planEvent(attack()))[0]).toBe('cannon');
    expect(ids(planEvent({ kind: 'mineBlast', pieceId: 'x', unit: 'Minador', owner: 'B', at: { r: 1, c: 1 }, damaged: true }))).toEqual(['explosion', 'splash']);
  });
});
