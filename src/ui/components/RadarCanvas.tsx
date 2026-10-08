import React, { useEffect, useRef } from 'react';
import { useSettings } from '../../store/settingsStore';
import { useThemeKey } from '../theme';

interface Props { width: number; height: number }

const MAX_CANVAS_SIDE = 1600;
const BASE_SPEED = 0.0036;

function cssRgb(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export const RadarCanvas: React.FC<Props> = ({ width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const radarOn = useSettings(s => s.radarOn);
  const radarSpeed = useSettings(s => s.radarSpeed);
  const radarIntensity = useSettings(s => s.radarIntensity);
  const themeKey = useThemeKey();
  const live = useRef({ radarOn, radarSpeed, radarIntensity });
  live.current = { radarOn, radarSpeed, radarIntensity };

  const scale = Math.min(1, MAX_CANVAS_SIDE / Math.max(width, height));
  const pxW = Math.max(1, Math.round(width * scale));
  const pxH = Math.max(1, Math.round(height * scale));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // El mar usa el tercer color (el del tablero), distinto del de las fichas.
    const rgb = cssRgb('--sea-rgb', '46, 150, 200');
    const bg = cssRgb('--sea-bg-rgb', '4, 14, 22');

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);

    let angle = 0;

    function draw() {
      const { radarOn: on, radarSpeed: speed, radarIntensity: k } = live.current;

      ctx.fillStyle = `rgba(${bg},0.92)`;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = `rgba(${rgb},0.11)`;
      ctx.lineWidth = 1;
      const cols = 24, rows = 20;
      const cw = width / cols, rh = height / rows;
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, height); ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * rh); ctx.lineTo(width, r * rh); ctx.stroke();
      }

      ctx.strokeStyle = `rgba(${rgb},0.14)`;
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (maxR / 4) * i, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = `rgba(${rgb},0.08)`;
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(width, cy); ctx.stroke();

      if (on) {
        const trailSpan = Math.PI * 0.55;
        for (let t = 0; t < 60; t++) {
          const a = angle - (trailSpan / 60) * t;
          const alpha = (1 - t / 60) * 0.16 * k;

          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, maxR * 1.5, a - trailSpan / 60, a, false);
          ctx.closePath();
          ctx.fillStyle = `rgba(${rgb},${alpha})`;
          ctx.fill();
        }

        const ex = cx + Math.cos(angle) * maxR * 1.5;
        const ey = cy + Math.sin(angle) * maxR * 1.5;
        const ledge = ctx.createLinearGradient(cx, cy, ex, ey);
        ledge.addColorStop(0, `rgba(${rgb},0)`);
        ledge.addColorStop(0.4, `rgba(${rgb},${0.1 * k})`);
        ledge.addColorStop(1, `rgba(${rgb},${Math.min(1, 0.5 * k)})`);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = ledge;
        ctx.lineWidth = 2;
        ctx.stroke();

        if (Math.random() > 0.994) {
          const bx = Math.random() * width;
          const by = Math.random() * height;
          const br = ctx.createRadialGradient(bx, by, 0, bx, by, 6);
          br.addColorStop(0, `rgba(${rgb},${Math.min(1, 0.8 * k)})`);
          br.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = br;
          ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
        }

        angle += BASE_SPEED * speed;
        if (angle > Math.PI * 2) angle -= Math.PI * 2;
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height, scale, themeKey]);

  return (
    <canvas
      ref={ref}
      width={pxW}
      height={pxH}
      style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none', zIndex: 0 }}
    />
  );
};
