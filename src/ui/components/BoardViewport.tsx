import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSettings, ZOOM_MAX, ZOOM_MIN } from '../../store/settingsStore';
import { displayDims, type Rot } from '../boardRotation';
import { mix } from '../ui';

const PAD = 4;
const ZOOM_STEP = 1.2;
const MIN_CELL = 10;
const MAX_CELL = 220;

interface Props {
  cols: number;
  rows: number;
  children: (cellSize: number, rot: Rot) => React.ReactNode;
}

export function useEffectiveRotation(cols: number, rows: number, w: number, h: number): Rot {
  const rotation = useSettings(s => s.rotation);
  const fitFor = (r: Rot) => {
    const { dc, dr } = displayDims(r, cols, rows);
    return Math.max(8, Math.floor(Math.min((w - 2 * PAD) / dc, (h - 2 * PAD) / dr)));
  };
  const autoRot: Rot = fitFor(90) > fitFor(0) * 1.05 ? 90 : 0;
  return rotation === 'auto' ? autoRot : rotation;
}

export const BoardViewport: React.FC<Props> = ({ cols, rows, children }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const zoom = useSettings(s => s.zoom);
  const zoomBy = useSettings(s => s.zoomBy);

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

  const rot = useEffectiveRotation(cols, rows, size.w, size.h);
  const { dc, dr } = displayDims(rot, cols, rows);
  const fit = Math.max(8, Math.floor(Math.min((size.w - 2 * PAD) / dc, (size.h - 2 * PAD) / dr)));
  const cell = Math.min(MAX_CELL, Math.max(MIN_CELL, Math.round(fit * zoom)));

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
    </div>
  );
};

const IconBtn: React.FC<{
  label: string; title: string; onClick: () => void; disabled?: boolean; wide?: boolean;
}> = ({ label, title, onClick, disabled, wide }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      flex: wide ? 1.4 : 1, height: 32, minWidth: 32, padding: '0 6px',
      background: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
      border: '1px solid var(--line)', borderRadius: 4,
      color: disabled ? 'var(--main-mute)' : 'var(--main)', fontSize: 14, lineHeight: 1,
      opacity: disabled ? 0.5 : 1,
    }}
    onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = mix('var(--main)', 12); }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
  >
    {label}
  </button>
);

export const ViewControls: React.FC<{ vertical?: boolean }> = ({ vertical }) => {
  const zoom = useSettings(s => s.zoom);
  const zoomBy = useSettings(s => s.zoomBy);
  const resetZoom = useSettings(s => s.resetZoom);
  const rotation = useSettings(s => s.rotation);
  const setSetting = useSettings(s => s.set);
  const nextRot = (): Rot => {
    const cur: Rot = rotation === 'auto' ? 0 : rotation;
    return ((cur + 90) % 360) as Rot;
  };

  return (
    <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: 4 }}>
      <IconBtn label="−" title="Alejar (Ctrl + rueda)" disabled={zoom <= ZOOM_MIN} onClick={() => zoomBy(1 / ZOOM_STEP)} />
      <IconBtn
        label={`${Math.round(zoom * 100)}%`}
        title="Ajustar a pantalla"
        wide
        onClick={resetZoom}
      />
      <IconBtn label="+" title="Acercar (Ctrl + rueda)" disabled={zoom >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)} />
      <IconBtn
        label={rotation === 'auto' ? '⟳A' : `⟳${rotation}°`}
        title="Rotar tablero 90° (en el menú: AUTO)"
        wide
        onClick={() => setSetting({ rotation: nextRot() })}
      />
    </div>
  );
};
