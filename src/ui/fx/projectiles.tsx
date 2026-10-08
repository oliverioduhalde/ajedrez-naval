import React from 'react';
import { anim, axis, centered, cssVars, prefersReducedMotion, rnd } from './geometry';
import type { FxProps } from './parts';

/** Contenedor de tamaño 0 en el origen del disparo, rotado para que +x apunte al blanco. */
const Axis: React.FC<{ x: number; y: number; angle: number; children: React.ReactNode }> = ({ x, y, angle, children }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, transform: `rotate(${angle}deg)` }}>
    {children}
  </div>
);

/** Fogonazo y humo del cañón, o destellos intermitentes de la ametralladora. */
export const Muzzle: React.FC<FxProps<'muzzle'>> = ({ spec, delay, cs, rot }) => {
  const { origin, angle } = axis(rot, spec.cell, spec.toward, cs);

  if (spec.weapon === 'gun') {
    // Dos destellos con períodos distintos para que la ráfaga no se vea mecánica.
    const flashes = [
      { period: 97, size: 0.42, at: 0.3 },
      { period: 131, size: 0.3, at: 0.38 },
    ];
    return (
      <Axis x={origin.x} y={origin.y} angle={angle}>
        {flashes.map((f, i) => (
          <div key={i} style={{
            ...centered(f.size * cs), left: f.at * cs - (f.size * cs) / 2, borderRadius: '50%',
            background: 'radial-gradient(circle, #fff 0%, #fff1a0 30%, #ffa63a 62%, rgba(255,110,20,0) 100%)',
            animation: anim('fx-gun-flash', f.period, delay, { count: Math.max(1, Math.floor(spec.dur / f.period)), ease: 'linear' }),
          }} />
        ))}
      </Axis>
    );
  }

  const smoke = [
    { x: 0.36, y: -0.06, d: 0 },
    { x: 0.58, y: 0.08, d: 30 },
    { x: 0.8, y: -0.02, d: 70 },
  ];
  return (
    <Axis x={origin.x} y={origin.y} angle={angle}>
      {smoke.map((s, i) => (
        <div key={i} style={{
          ...centered(cs * 0.5), left: s.x * cs - cs * 0.25, top: s.y * cs - cs * 0.25, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(200,200,206,0.85) 0%, rgba(150,150,158,0.5) 50%, rgba(120,120,128,0) 72%)',
          ...cssVars({ '--drift': cs * 0.45 }),
          animation: anim('fx-muzzle-smoke', spec.dur - s.d, delay + s.d),
        }} />
      ))}
      <div style={{
        position: 'absolute', left: 0.2 * cs, top: -0.28 * cs, width: 1.1 * cs, height: 0.56 * cs, transformOrigin: '0% 50%',
        background: 'radial-gradient(ellipse 100% 50% at 0% 50%, #fff 0%, #ffe9a0 18%, #ffa63a 45%, rgba(255,110,20,0.5) 70%, rgba(255,80,0,0) 100%)',
        animation: anim('fx-muzzle-blast', 210, delay),
      }} />
      <div style={{
        ...centered(cs * 0.42), left: 0.2 * cs - cs * 0.21, borderRadius: '50%',
        background: 'radial-gradient(circle, #fff 0%, rgba(255,240,180,0.8) 45%, rgba(255,200,80,0) 72%)',
        animation: anim('fx-flash', 170, delay),
      }} />
    </Axis>
  );
};

/** Proyectil de cañón: núcleo blanco-amarillo con halo naranja y estela corta, a velocidad constante. */
export const Shell: React.FC<FxProps<'shell'>> = ({ spec, delay, cs, rot }) => {
  const { origin, angle, length } = axis(rot, spec.from, spec.to, cs);
  const x0 = Math.min(0.45 * cs, length * 0.35);
  const core = Math.max(5, cs * 0.17);
  const trail = Math.max(10, cs * 0.7);

  return (
    <Axis x={origin.x} y={origin.y} angle={angle}>
      <div style={{
        position: 'absolute', left: 0, top: 0, width: 0, height: 0,
        ...cssVars({ '--x0': x0, '--x1': length }),
        animation: anim('fx-fly', spec.dur, delay, { ease: 'linear' }),
      }}>
        <div style={{
          position: 'absolute', right: 0, top: -Math.max(1.5, cs * 0.055), width: trail, height: Math.max(3, cs * 0.11),
          borderRadius: 3,
          background: 'linear-gradient(to left, rgba(255,214,110,0.95), rgba(255,130,35,0.55) 40%, rgba(255,90,20,0))',
        }} />
        <div style={{
          ...centered(core), borderRadius: '50%',
          background: 'radial-gradient(circle, #fff 0%, #fff6b0 38%, #ffb347 70%, rgba(255,120,20,0) 100%)',
          boxShadow: '0 0 6px 2px rgba(255,160,50,0.85)',
        }} />
      </div>
    </Axis>
  );
};

/** Ráfaga de trazadoras escalonadas entre dos celdas. */
export const Tracers: React.FC<FxProps<'tracers'>> = ({ spec, seed, delay, cs, rot }) => {
  const { origin, angle, length } = axis(rot, spec.from, spec.to, cs);
  const n = prefersReducedMotion() ? 4 : 8;
  const travel = Math.min(280, spec.dur * 0.5);
  const len = Math.max(10, cs * 0.6);
  const thick = Math.max(1.5, cs * 0.05);

  return (
    <Axis x={origin.x} y={origin.y} angle={angle}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{
          position: 'absolute', left: 0, top: (rnd(seed, i, 1) - 0.5) * 0.24 * cs, width: 0, height: 0,
          ...cssVars({ '--x0': Math.min(0.45 * cs, length * 0.35), '--x1': Math.max(0, length - 0.05 * cs) }),
          animation: anim('fx-fly', travel, delay + (i * (spec.dur - travel)) / (n - 1), { ease: 'linear' }),
        }}>
          <div style={{
            position: 'absolute', right: 0, top: -thick / 2, width: len, height: thick, borderRadius: thick,
            background: 'linear-gradient(to left, #fff7c0, #ffd23a 25%, #ff8a1e 60%, rgba(255,120,20,0))',
            boxShadow: '0 0 3px rgba(255,170,50,0.9)',
          }} />
        </div>
      ))}
    </Axis>
  );
};

/** Torpedo con estela de burbujas, rastro de espuma y ondas en V. */
export const Torpedo: React.FC<FxProps<'torpedo'>> = ({ spec, seed, delay, cs, rot }) => {
  const { origin, angle, length } = axis(rot, spec.from, spec.to, cs);
  const x0 = Math.min(0.35 * cs, length * 0.3);
  const x1 = Math.max(x0, length - 0.1 * cs);
  const bw = Math.max(14, cs * 0.72);
  const bh = Math.max(4.5, cs * 0.2);
  const nBubbles = prefersReducedMotion() ? 5 : Math.min(18, Math.max(7, Math.round((x1 - x0) / (cs * 0.3))));
  const foam = Math.max(1.5, cs * 0.05);

  return (
    <Axis x={origin.x} y={origin.y} angle={angle}>
      <div style={{ position: 'absolute', left: x0, top: -foam / 2, width: x1 - x0, height: foam, transformOrigin: '0% 50%', animation: anim('fx-grow-x', spec.dur, delay, { ease: 'linear' }) }}>
        <div style={{
          width: '100%', height: '100%', borderRadius: foam,
          background: 'linear-gradient(to right, rgba(225,243,255,0), rgba(225,243,255,0.55))',
          animation: anim('fx-fade-out', spec.dur + 700, delay, { ease: 'ease-in' }),
        }} />
      </div>

      {Array.from({ length: nBubbles }, (_, i) => {
        const t = (i + 0.5) / nBubbles;
        const size = Math.max(2, cs * (0.05 + 0.05 * rnd(seed, i)));
        const lateral = (rnd(seed, i, 1) - 0.5) * 0.26 * cs;
        return (
          <div key={i} style={{
            ...centered(size), left: x0 + t * (x1 - x0) - size / 2, top: lateral - size / 2, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 30%, #fff, rgba(215,238,252,0.75) 60%, rgba(200,230,250,0.25))',
            ...cssVars({ '--rise': (rnd(seed, i, 2) - 0.5) * 0.3 * cs }),
            animation: anim('fx-bubble', 750, delay + t * spec.dur),
          }} />
        );
      })}

      <div style={{
        position: 'absolute', left: 0, top: 0, width: 0, height: 0,
        ...cssVars({ '--x0': x0, '--x1': x1 }),
        animation: anim('fx-fly', spec.dur, delay, { ease: 'linear' }),
      }}>
        {[-14, 14].map(deg => (
          <div key={deg} style={{
            position: 'absolute', right: bw - 2, top: -foam / 2, width: Math.max(12, cs * 0.9), height: foam,
            transformOrigin: '100% 50%', transform: `rotate(${deg}deg)`,
            background: 'linear-gradient(to left, rgba(255,255,255,0.55), rgba(255,255,255,0))',
          }} />
        ))}
        <svg
          width={bw} height={bh} viewBox="0 0 40 12" preserveAspectRatio="none"
          style={{ position: 'absolute', left: -bw, top: -bh / 2, overflow: 'visible' }}
        >
          <path d="M3 2 L-1 -0.5 L6 2 Z M3 10 L-1 12.5 L6 10 Z" fill="#2c343c" />
          <path d="M3 2 L29 2 Q39 6 29 10 L3 10 Q1 6 3 2 Z" fill="#46505a" stroke="#161b21" strokeWidth="0.8" />
          <path d="M5 3.4 L28 3.4 Q34 4.6 28 5.8 L5 5.8 Z" fill="#8a97a3" opacity="0.55" />
          <rect x="19" y="2" width="1.8" height="8" fill="#c9a227" opacity="0.85" />
        </svg>
      </div>
    </Axis>
  );
};
