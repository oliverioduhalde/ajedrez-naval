import React, { useId } from 'react';
import { useSettings } from '../../store/settingsStore';
import { cssVars, hashString, prefersReducedMotion, rnd } from './geometry';

interface Props {
  /** lado de la ficha en px (la caja sobre la que arden las llamas) */
  cellSize: number;
  /** texto estable (id de la ficha) para desfasar el parpadeo de cada barco */
  seed: string;
  /** sin fundido de entrada (fantasma de un barco que ya venía ardiendo) */
  instant?: boolean;
  /** las llamas quedan dentro de la caja (ficha ampliada, donde el contenedor recorta) */
  contained?: boolean;
}

// Lenguas por cantidad: centro x, ancho y alto en unidades del viewBox (0..100).
const TONGUES: Record<3 | 4 | 5, { x: number; w: number; h: number }[]> = {
  3: [{ x: 28, w: 30, h: 62 }, { x: 52, w: 34, h: 92 }, { x: 74, w: 26, h: 54 }],
  4: [{ x: 22, w: 26, h: 60 }, { x: 42, w: 32, h: 94 }, { x: 60, w: 28, h: 76 }, { x: 80, w: 24, h: 52 }],
  5: [{ x: 16, w: 22, h: 50 }, { x: 33, w: 28, h: 78 }, { x: 50, w: 32, h: 96 }, { x: 67, w: 26, h: 74 }, { x: 84, w: 22, h: 48 }],
};

/** Gota de fuego con la punta hacia arriba, apoyada en y = 100. `tip` desplaza la punta de costado. */
function tonguePath(cx: number, w: number, h: number, tip: number): string {
  const l = cx - w / 2;
  const r = cx + w / 2;
  const b = 100;
  return `M${l} ${b} C${l} ${b - h * 0.45} ${cx - w * 0.1 + tip * 0.5} ${b - h * 0.7} ${cx + tip} ${b - h} `
    + `C${cx + w * 0.1 + tip * 0.5} ${b - h * 0.7} ${r} ${b - h * 0.45} ${r} ${b} Q${cx} ${b + w * 0.28} ${l} ${b} Z`;
}

/**
 * Llamas en vivo sobre un barco averiado. Se dibujan derechas (no heredan la rotación de la ficha)
 * y con overflow visible: el contenedor debe tener la misma caja que la ficha y pointer-events ajenos.
 */
export const DamagedFlames: React.FC<Props> = ({ cellSize, seed, instant, contained }) => {
  const fxOn = useSettings(s => s.fxOn);
  const uid = useId();
  if (!fxOn) return null;

  const h = hashString(seed);
  const reduced = prefersReducedMotion();
  const count: 3 | 4 | 5 = cellSize >= 40 ? 5 : cellSize >= 20 ? 4 : 3;
  const embers = reduced || cellSize < 20 ? 0 : cellSize >= 34 ? 3 : 2;
  const smoke = !reduced && cellSize >= 20;
  const base = contained ? 84 : 58; // % de la altura de la ficha donde nacen las llamas
  const boxStyle: React.CSSProperties = contained
    ? { top: 0, height: `${base}%` }
    : { top: `${base - 100}%`, height: '100%' };
  const gOuter = `${uid}-o`;
  const gMid = `${uid}-m`;
  const gCore = `${uid}-c`;

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4, overflow: 'visible',
        transformOrigin: `50% ${base}%`,
        animation: instant ? undefined : 'fx-flames-in 900ms ease-out both',
      }}
    >
      <div style={{
        position: 'absolute', inset: '6%', borderRadius: 6,
        background: 'radial-gradient(ellipse at 50% 60%, rgba(255,140,30,0.6), rgba(255,90,10,0.26) 55%, rgba(255,60,0,0) 78%)',
        animation: `fx-flame-glow ${1100 + (h % 5) * 120}ms ease-in-out ${-(h % 900)}ms infinite`,
      }} />

      <svg
        viewBox="0 0 100 100" preserveAspectRatio="none"
        style={{ position: 'absolute', left: '2%', width: '96%', overflow: 'visible', ...boxStyle }}
      >
        <defs>
          <linearGradient id={gOuter} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff3a0a" stopOpacity="0" />
            <stop offset="0.28" stopColor="#ff4b10" stopOpacity="0.85" />
            <stop offset="0.62" stopColor="#ff8a1c" />
            <stop offset="1" stopColor="#ffc233" />
          </linearGradient>
          <linearGradient id={gMid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffaa28" stopOpacity="0" />
            <stop offset="0.3" stopColor="#ffa322" stopOpacity="0.9" />
            <stop offset="0.72" stopColor="#ffd54a" />
            <stop offset="1" stopColor="#fff2a0" />
          </linearGradient>
          <linearGradient id={gCore} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff1a8" stopOpacity="0" />
            <stop offset="0.4" stopColor="#fff1a8" stopOpacity="0.95" />
            <stop offset="1" stopColor="#ffffff" />
          </linearGradient>
        </defs>
        {TONGUES[count].map((t, j) => {
          const tip = (rnd(h, j) - 0.5) * t.w * 0.5;
          const dur = 350 + 450 * rnd(h, j, 1);
          const delay = -Math.round(rnd(h, j, 2) * 800);
          return (
            <g
              key={j}
              className="fx-flick"
              style={{
                transformBox: 'fill-box', transformOrigin: '50% 100%',
                animation: `${j % 2 ? 'fx-flick-b' : 'fx-flick-a'} ${Math.round(dur)}ms ease-in-out ${delay}ms infinite`,
              }}
            >
              <path d={tonguePath(t.x, t.w, t.h, tip)} fill={`url(#${gOuter})`} />
              <path d={tonguePath(t.x, t.w * 0.66, t.h * 0.7, tip * 0.6)} fill={`url(#${gMid})`} />
              <path d={tonguePath(t.x, t.w * 0.38, t.h * 0.42, tip * 0.3)} fill={`url(#${gCore})`} />
            </g>
          );
        })}
      </svg>

      {Array.from({ length: embers }, (_, i) => {
        const size = Math.max(2, cellSize * 0.055);
        return (
          <div key={`ember${i}`} style={{
            position: 'absolute', left: `${32 + 36 * rnd(h, i, 3)}%`, top: `${base - 8}%`, width: size, height: size,
            borderRadius: '50%', background: '#ffb347', boxShadow: '0 0 4px 1px rgba(255,140,40,0.85)',
            ...cssVars({ '--ex': (rnd(h, i, 4) - 0.5) * 0.45 * cellSize, '--ey': -(0.9 + 0.5 * rnd(h, i, 5)) * cellSize }),
            animation: `fx-ember ${Math.round(1500 + 900 * rnd(h, i, 6))}ms ease-out ${-Math.round(rnd(h, i, 7) * 2000)}ms infinite`,
          }} />
        );
      })}

      {smoke && (
        <div style={{
          position: 'absolute', left: '50%', top: `${base - 70}%`, width: cellSize * 0.5, height: cellSize * 0.5, marginLeft: -cellSize * 0.25,
          borderRadius: '50%', background: 'radial-gradient(circle, rgba(120,118,126,0.65), rgba(100,98,106,0) 70%)',
          ...cssVars({ '--ey': -cellSize * 0.9 }),
          animation: `fx-smoke-thread 2600ms ease-out ${-(h % 2000)}ms infinite`,
        }} />
      )}
    </div>
  );
};
