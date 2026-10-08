import React, { useEffect, useRef } from 'react';

interface Props {
  width: number;
  height: number;
}

// Animated ocean using canvas — subtle parallax wave shimmer
export const SeaCanvas: React.FC<Props> = ({ width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let t = 0;

    function draw() {
      ctx.clearRect(0, 0, width, height);

      // Layer 1 — base gradient
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#0c2240');
      grad.addColorStop(0.5, '#0a3d62');
      grad.addColorStop(1, '#06294a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Layer 2 — slow shimmer lines (caustic-like)
      for (let row = 0; row < 6; row++) {
        const y = (height / 6) * row + (height / 12);
        const phase = row * 1.3;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 2) {
          const amp = 4 + 2 * Math.sin(x * 0.02 + phase);
          const wy = y + amp * Math.sin(x * 0.018 + t * 0.4 + phase);
          if (x === 0) ctx.moveTo(x, wy);
          else ctx.lineTo(x, wy);
        }
        ctx.strokeStyle = `rgba(96,165,250,${0.04 + 0.02 * Math.sin(t * 0.3 + row)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Layer 3 — fine ripple grid
      for (let gy = 0; gy < height; gy += 22) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 3) {
          const wy = gy + 1.5 * Math.sin(x * 0.04 + t * 0.6 + gy * 0.03);
          if (x === 0) ctx.moveTo(x, wy);
          else ctx.lineTo(x, wy);
        }
        ctx.strokeStyle = 'rgba(147,197,253,0.035)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Layer 4 — occasional sparkle
      if (Math.sin(t * 0.7) > 0.85) {
        const sx = (Math.sin(t * 1.3) * 0.5 + 0.5) * width;
        const sy = (Math.cos(t * 0.9) * 0.5 + 0.5) * height;
        const spark = ctx.createRadialGradient(sx, sy, 0, sx, sy, 8);
        spark.addColorStop(0, 'rgba(255,255,255,0.25)');
        spark.addColorStop(1, 'transparent');
        ctx.fillStyle = spark;
        ctx.fillRect(sx - 8, sy - 8, 16, 16);
      }

      t += 0.02;
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
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
};
