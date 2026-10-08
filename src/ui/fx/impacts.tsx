import React from 'react';
import { anim, cellCenter, centered, cssVars, prefersReducedMotion, rnd } from './geometry';
import { Anchor, Ring, type FxProps } from './parts';

const GOLDEN_ANGLE = 2.39996;

const SIZE_K = { small: 1, medium: 1.6, large: 2.3 } as const;

/** Bola de fuego + onda expansiva + chispas con gravedad + humo. */
export const Explosion: React.FC<FxProps<'explosion'>> = ({ spec, seed, delay, cs, rot }) => {
  const { x, y } = cellCenter(rot, spec.cell, cs);
  const reduced = prefersReducedMotion();
  const k = SIZE_K[spec.size];
  const D = k * cs;
  const T = spec.dur;
  const nSparks = reduced ? 4 : spec.size === 'small' ? 8 : spec.size === 'medium' ? 11 : 14;
  const lobes = spec.size === 'small'
    ? [{ dx: 0, dy: 0, s: 1, d: 0 }]
    : [{ dx: 0, dy: 0, s: 1, d: 0 }, { dx: 0.18, dy: -0.15, s: 0.72, d: 60 }, { dx: -0.2, dy: 0.1, s: 0.62, d: 40 }];

  return (
    <Anchor x={x} y={y}>
      <div style={{
        ...centered(D * 2.6), borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,160,60,0.5) 0%, rgba(255,110,30,0.22) 45%, rgba(255,90,20,0) 70%)',
        animation: anim('fx-glow', T * 0.55, delay),
      }} />

      {[0, 1, 2].map(i => (
        <div key={`smoke${i}`} style={{
          ...centered(D * (0.78 - i * 0.08)), borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(92,90,98,0.9) 0%, rgba(74,72,80,0.6) 45%, rgba(70,68,76,0) 72%)',
          ...cssVars({ '--dx': (rnd(seed, i, 3) - 0.5) * D * 0.55, '--dy': -D * (0.5 + 0.4 * rnd(seed, i, 4)) }),
          animation: anim('fx-smoke', T * 0.85, delay + T * 0.1 * i),
        }} />
      ))}

      <Ring w={D * 1.9} h={D * 1.9} delay={delay} dur={600 + 80 * k} color="rgba(255,238,200,0.9)" fill="rgba(255,220,160,0.06)" />

      {lobes.map((l, i) => {
        const w = D * l.s;
        return (
          <div key={`lobe${i}`} style={{
            position: 'absolute', left: l.dx * D - w / 2, top: l.dy * D - w / 2, width: w, height: w, borderRadius: '50%',
            background: 'radial-gradient(circle, #fff 0%, #fff2a8 14%, #ffc83a 32%, #ff8a1c 52%, #e8430f 70%, rgba(150,30,5,0.55) 84%, rgba(120,20,0,0) 100%)',
            animation: anim('fx-fireball', T - l.d, delay + l.d),
          }} />
        );
      })}

      <div style={{
        ...centered(D * 0.9), borderRadius: '50%',
        background: 'radial-gradient(circle, #fff 0%, rgba(255,255,255,0.85) 35%, rgba(255,255,255,0) 70%)',
        animation: anim('fx-flash', 320, delay),
      }} />

      {Array.from({ length: nSparks }, (_, i) => {
        const a = i * GOLDEN_ANGLE + rnd(seed, i) * 0.6;
        const R = D * (0.5 + 0.7 * rnd(seed, i, 1));
        const size = Math.max(2, cs * 0.075 * (0.8 + 0.6 * rnd(seed, i, 2)));
        return (
          <div key={`spark${i}`} style={{
            ...centered(size), borderRadius: '50%',
            background: 'radial-gradient(circle, #fff 0%, #ffd060 45%, #ff7a1a 100%)',
            boxShadow: '0 0 4px 1px rgba(255,160,40,0.8)',
            ...cssVars({ '--sx': Math.cos(a) * R, '--sy': Math.sin(a) * R * 0.9 - 0.35 * R, '--sg': 0.8 * R }),
            animation: anim('fx-spark-fly', T * (0.6 + 0.25 * rnd(seed, i, 5)), delay + 60 * rnd(seed, i, 6), { ease: 'linear' }),
          }} />
        );
      })}
    </Anchor>
  );
};

/** Columna de agua que sube y se abre, gotas en arco y anillos elípticos. */
export const Splash: React.FC<FxProps<'splash'>> = ({ spec, seed, delay, cs, rot }) => {
  const { x, y } = cellCenter(rot, spec.cell, cs);
  const reduced = prefersReducedMotion();
  const big = spec.size === 'big';
  const K = big ? 1.35 : 0.8;
  const T = spec.dur;
  const colW = Math.max(6, 0.5 * cs * K);
  const colH = 1.5 * cs * K;
  const nDrops = reduced ? 4 : big ? 12 : 7;
  const rMax = (big ? 2 : 1) * cs;

  return (
    <Anchor x={x} y={y}>
      {[0, 0.17, 0.34].map((f, i) => (
        <Ring
          key={`ring${i}`} w={2 * rMax} h={rMax} delay={delay + T * f} dur={T * 0.6}
          color="rgba(225,243,255,0.9)" fill="rgba(190,225,250,0.12)"
        />
      ))}

      <div style={{
        position: 'absolute', left: -colW / 2, top: -colH, width: colW, height: colH, transformOrigin: '50% 100%',
        borderRadius: '50% 50% 10% 10% / 22% 22% 8% 8%',
        background: 'linear-gradient(to top, rgba(165,212,240,0.55), rgba(230,246,255,0.92) 45%, rgba(255,255,255,0.96))',
        animation: anim('fx-water-column', T, delay),
      }} />

      {[{ f: 0.45, w: 0.85, d: 0.05 }, { f: 0.8, w: 1.05, d: 0.1 }, { f: 1, w: 0.7, d: 0.15 }].map((p, i) => {
        const w = p.w * cs * K;
        return (
          <div key={`puff${i}`} style={{
            ...centered(w, w * 0.45), top: -colH * p.f - (w * 0.45) / 2, borderRadius: '50%',
            background: 'radial-gradient(ellipse at 50% 55%, rgba(255,255,255,0.95), rgba(200,230,250,0.8) 50%, rgba(160,210,240,0) 72%)',
            ...cssVars({ '--lift': 0.5 * cs * K }),
            animation: anim('fx-water-puff', T * 0.7, delay + T * p.d),
          }} />
        );
      })}

      {Array.from({ length: nDrops }, (_, i) => {
        const dir = rnd(seed, i) < 0.5 ? -1 : 1;
        const size = Math.max(2, cs * K * (0.06 + 0.05 * rnd(seed, i, 1)));
        return (
          <div key={`drop${i}`} style={{
            ...centered(size), borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, #fff, #bfe3f8 60%, #8ec9ec)',
            ...cssVars({
              '--sx': dir * (0.35 + 0.8 * rnd(seed, i, 2)) * cs * K,
              '--sy': -(1.1 + 0.9 * rnd(seed, i, 3)) * cs * K,
              '--sg': (1.2 + 0.9 * rnd(seed, i, 4)) * cs * K,
            }),
            animation: anim('fx-spark-fly', T * (0.55 + 0.25 * rnd(seed, i, 5)), delay + 20 + 120 * rnd(seed, i, 6), { ease: 'linear' }),
          }} />
        );
      })}
    </Anchor>
  );
};

/** Chispas de impacto sobre un blanco que no recibe daño. */
export const Sparks: React.FC<FxProps<'sparks'>> = ({ spec, seed, delay, cs, rot }) => {
  const { x, y } = cellCenter(rot, spec.cell, cs);
  const n = prefersReducedMotion() ? 3 : 7;

  return (
    <Anchor x={x} y={y}>
      <div style={{
        ...centered(cs * 0.55), borderRadius: '50%',
        background: 'radial-gradient(circle, #fff 0%, rgba(255,240,170,0.8) 40%, rgba(255,200,80,0) 72%)',
        animation: anim('fx-flash', 240, delay),
      }} />
      {Array.from({ length: n }, (_, i) => {
        const a = i * GOLDEN_ANGLE + rnd(seed, i) * 0.7;
        const R = cs * (0.45 + 0.5 * rnd(seed, i, 1));
        const size = Math.max(2, cs * 0.06);
        return (
          <div key={i} style={{
            ...centered(size), borderRadius: '50%',
            background: 'radial-gradient(circle, #fff 0%, #ffe27a 55%, #ffa030 100%)',
            boxShadow: '0 0 3px 1px rgba(255,190,70,0.8)',
            ...cssVars({ '--sx': Math.cos(a) * R, '--sy': Math.sin(a) * R * 0.8 - 0.25 * R, '--sg': 0.45 * R }),
            animation: anim('fx-spark-fly', spec.dur * (0.6 + 0.3 * rnd(seed, i, 2)), delay + 40 * rnd(seed, i, 3), { ease: 'linear' }),
          }} />
        );
      })}
    </Anchor>
  );
};
