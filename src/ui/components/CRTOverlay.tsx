import React, { useEffect, useRef } from 'react';

// Static noise canvas
const NoiseCanvas: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    let frame = 0;
    function draw() {
      // Only redraw noise every 3 frames for perf
      if (frame % 3 === 0) {
        const img = ctx.createImageData(width, height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = Math.random() > 0.995 ? Math.floor(Math.random() * 80) : 0;
          d[i] = 0; d[i+1] = v; d[i+2] = 0; d[i+3] = v ? 180 : 0;
        }
        ctx.putImageData(img, 0, 0);
      }
      frame++;
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

export const CRTOverlay: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: '#000a02',
      animation: 'crt-flicker 8s infinite, flicker-fast 0.15s infinite',
    }}>
      {/* Glitch layer wraps everything */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        animation: 'glitch-h 12s infinite, glitch-rgb 12s infinite',
      }}>
        {children}
      </div>

      {/* Scanlines overlay */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9998,
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 4px)',
        backgroundSize: '100% 4px',
        animation: 'scanline-scroll 0.12s linear infinite',
      }} />

      {/* Vignette */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.75) 100%)',
      }} />

      {/* Screen curve reflection */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9997,
        background: 'radial-gradient(ellipse at 30% 20%, rgba(0,255,100,0.03) 0%, transparent 60%)',
      }} />
    </div>
  );
};
