import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings, ZOOM_MAX, ZOOM_MIN } from '../../store/settingsStore';
import { displayDims, type Rot } from '../boardRotation';

const PAD = 20;
const ZOOM_STEP = 1.2;
const MIN_CELL = 10;
const MAX_CELL = 220;

interface Props {
  cols: number;
  rows: number;
  children: (cellSize: number, rot: Rot) => React.ReactNode;
}

export const BoardViewport: React.FC<Props> = ({ cols, rows, children }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const zoom = useSettings(s => s.zoom);
  const zoomBy = useSettings(s => s.zoomBy);
  const resetZoom = useSettings(s => s.resetZoom);
  const rotation = useSettings(s => s.rotation);
  const setSetting = useSettings(s => s.set);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    const obs = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    }
    let lastDist = 0;
    function dist(t: TouchList) {
      return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    }
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) lastDist = dist(e.touches);
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || lastDist === 0) return;
      e.preventDefault();
      const d = dist(e.touches);
      zoomBy(d / lastDist);
      lastDist = d;
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) lastDist = 0;
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [zoomBy]);

  const fitFor = (r: Rot) => {
    const { dc, dr } = displayDims(r, cols, rows);
    return Math.max(8, Math.floor(Math.min((size.w - 2 * PAD) / dc, (size.h - 2 * PAD) / dr)));
  };
  const autoRot: Rot = fitFor(90) > fitFor(0) * 1.05 ? 90 : 0;
  const rot: Rot = rotation === 'auto' ? autoRot : rotation;
  const { dc, dr } = displayDims(rot, cols, rows);
  const cell = Math.min(MAX_CELL, Math.max(MIN_CELL, Math.round(fitFor(rot) * zoom)));

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', inset: 0, overflow: 'auto', display: 'flex', padding: PAD, touchAction: 'pan-x pan-y' }}>
        <div style={{ margin: 'auto', position: 'relative', width: cell * dc, height: cell * dr, flexShrink: 0 }}>
          {size.w > 0 && children(cell, rot)}
        </div>
      </div>

      <div style={{
        position: 'absolute', left: 8, bottom: 8, zIndex: 20,
        display: 'flex', alignItems: 'center',
        border: '1px solid #003311', background: 'rgba(0,10,2,0.88)',
      }}>
        <ZoomBtn label="−" title="Alejar (Ctrl + rueda)" disabled={zoom <= ZOOM_MIN} onClick={() => zoomBy(1 / ZOOM_STEP)} />
        <button
          onClick={resetZoom}
          title="Ajustar a pantalla"
          style={{
            minWidth: 54, height: 26, padding: '0 6px',
            background: 'transparent', border: 'none', borderLeft: '1px solid #003311', borderRight: '1px solid #003311',
            color: Math.abs(zoom - 1) < 0.01 ? '#00ff66' : '#00cc44',
            fontSize: 10, letterSpacing: 1, cursor: 'pointer',
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <ZoomBtn label="+" title="Acercar (Ctrl + rueda)" disabled={zoom >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)} />
        <button
          onClick={() => setSetting({ rotation: ((rot + 90) % 360) as Rot })}
          title="Rotar tablero 90°"
          style={{
            minWidth: 54, height: 26, padding: '0 6px',
            background: 'transparent', border: 'none', borderLeft: '1px solid #003311',
            color: '#00cc44', fontSize: 10, letterSpacing: 1, cursor: 'pointer',
          }}
        >
          ⟳ {rot}°{rotation === 'auto' ? ' A' : ''}
        </button>
      </div>
    </div>
  );
};

const ZoomBtn: React.FC<{ label: string; title: string; disabled: boolean; onClick: () => void }> = ({ label, title, disabled, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      width: 28, height: 26, background: 'transparent', border: 'none',
      color: disabled ? '#003311' : '#00ff66', fontSize: 15, lineHeight: 1,
      cursor: disabled ? 'not-allowed' : 'pointer',
      textShadow: disabled ? 'none' : '0 0 6px #00ff66',
    }}
  >
    {label}
  </button>
);
