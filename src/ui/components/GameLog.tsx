import React, { useRef, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';

const LOG_COLORS: Record<string, string> = {
  HUNDIDO:  '#ff4444',
  DERRIBADO:'#ff6600',
  AVERIADO: '#ffaa00',
  ILESO:    '#004d1a',
  ILESA:    '#004d1a',
  GANA:     '#00ff66',
};

function lineColor(line: string): string {
  for (const [k, c] of Object.entries(LOG_COLORS)) {
    if (line.includes(k)) return c;
  }
  return '#006622';
}

export const GameLog: React.FC<{ fill?: boolean }> = ({ fill }) => {
  const { game } = useGameStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [game.log]);

  return (
    <div style={{
      border: '1px solid #003311',
      background: 'rgba(0,15,5,0.85)',
      flex: fill ? '1 1 auto' : '0 0 auto',
      minHeight: fill ? 120 : undefined,
      display: 'flex', flexDirection: 'column',
      position: 'relative',
    }}>
      {/* corner ticks */}
      {[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy], i) => (
        <div key={i} style={{
          position: 'absolute',
          top: sy < 0 ? -1 : 'auto', bottom: sy > 0 ? -1 : 'auto',
          left: sx < 0 ? -1 : 'auto', right: sx > 0 ? -1 : 'auto',
          width: 5, height: 5,
          borderTop:    sy < 0 ? '1px solid #00ff66' : 'none',
          borderBottom: sy > 0 ? '1px solid #00ff66' : 'none',
          borderLeft:   sx < 0 ? '1px solid #00ff66' : 'none',
          borderRight:  sx > 0 ? '1px solid #00ff66' : 'none',
        }} />
      ))}
      <div style={{ padding: '4px 8px', fontSize: 7, letterSpacing: 2, color: '#005522', borderBottom: '1px solid #002210' }}>
        REGISTRO DE COMBATE
      </div>
      <div ref={ref} style={{
        height: fill ? undefined : 90, flex: fill ? '1 1 0' : undefined, minHeight: 0,
        overflowY: 'auto', padding: '4px 8px',
      }}>
        {game.log.length === 0
          ? <div style={{ color: '#002d12', fontSize: 9, marginTop: 4 }}>SIN ACCIONES...</div>
          : game.log.map((line, i) => (
            <div key={i} style={{
              fontSize: 9, lineHeight: 1.7, color: lineColor(line),
              borderBottom: i < game.log.length - 1 ? '1px solid #001a08' : 'none',
            }}>
              <span style={{ color: '#003311', marginRight: 4 }}>{String(i+1).padStart(2,'0')}.</span>
              {line}
            </div>
          ))
        }
      </div>
    </div>
  );
};
