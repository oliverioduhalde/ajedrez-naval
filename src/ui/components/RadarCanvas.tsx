import React, { useEffect, useRef } from 'react';

interface Props { width: number; height: number }

export const RadarCanvas: React.FC<Props> = ({ width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);

    let angle = 0;

    function draw() {
      // Dark background fill
      ctx.fillStyle = 'rgba(0,10,2,0.85)';
      ctx.fillRect(0, 0, width, height);

      // Grid lines — dim green
      ctx.strokeStyle = 'rgba(0,200,80,0.06)';
      ctx.lineWidth = 1;
      const cols = 24, rows = 20;
      const cw = width / cols, rh = height / rows;
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, height); ctx.stroke();
      }
      for (let r = 0; r <= rows; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * rh); ctx.lineTo(width, r * rh); ctx.stroke();
      }

      // Concentric range rings (radar circles)
      ctx.strokeStyle = 'rgba(0,200,80,0.09)';
      for (let i = 1; i <= 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (maxR / 4) * i, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Cross-hairs
      ctx.strokeStyle = 'rgba(0,200,80,0.07)';
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(width, cy); ctx.stroke();

      // Sweep trail (phosphor persistence)
      const trailSpan = Math.PI * 0.55; // radians of glow trail
      for (let t = 0; t < 60; t++) {
        const a = angle - (trailSpan / 60) * t;
        const alpha = (1 - t / 60) * 0.18;

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, maxR * 1.5, a - trailSpan / 60, a, false);
        ctx.closePath();
        ctx.fillStyle = `rgba(0,255,80,${alpha})`;
        ctx.fill();
      }

      // Sweep leading edge — bright line
      const ex = cx + Math.cos(angle) * maxR * 1.5;
      const ey = cy + Math.sin(angle) * maxR * 1.5;
      const ledge = ctx.createLinearGradient(cx, cy, ex, ey);
      ledge.addColorStop(0, 'rgba(0,255,80,0)');
      ledge.addColorStop(0.4, 'rgba(0,255,80,0.12)');
      ledge.addColorStop(1, 'rgba(0,255,120,0.55)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.strokeStyle = ledge;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Occasional random blip (false contact)
      if (Math.random() > 0.994) {
        const bx = Math.random() * width;
        const by = Math.random() * height;
        const br = ctx.createRadialGradient(bx, by, 0, bx, by, 6);
        br.addColorStop(0, 'rgba(0,255,80,0.9)');
        br.addColorStop(1, 'rgba(0,255,80,0)');
        ctx.fillStyle = br;
        ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
      }

      angle += 0.0036; // rotation speed
      if (angle > Math.PI * 2) angle -= Math.PI * 2;

      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}
    />
  );
};
