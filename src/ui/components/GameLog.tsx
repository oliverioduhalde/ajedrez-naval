import React, { useRef, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { Card, Label } from '../ui';

const LOG_COLORS: Record<string, string> = {
  HUNDIDO: 'var(--danger)',
  DERRIBADO: 'var(--danger)',
  AVERIADO: 'var(--warn)',
  ILESO: 'var(--main-mute)',
  ILESA: 'var(--main-mute)',
  GANA: 'var(--main)',
};

function lineColor(line: string): string {
  for (const [k, c] of Object.entries(LOG_COLORS)) {
    if (line.includes(k)) return c;
  }
  return 'var(--main-soft)';
}

export const GameLog: React.FC<{ fill?: boolean }> = ({ fill }) => {
  const game = useGameStore(s => s.game);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [game.log]);

  return (
    <Card style={{
      flex: fill ? '1 1 auto' : '0 0 auto',
      minHeight: fill ? 120 : undefined,
      display: 'flex', flexDirection: 'column', padding: '10px 0 0',
    }}>
      <Label style={{ padding: '0 12px 8px', borderBottom: '1px solid var(--line)' }}>Registro de combate</Label>
      <div ref={ref} style={{
        height: fill ? undefined : 110, flex: fill ? '1 1 0' : undefined, minHeight: 0,
        overflowY: 'auto', padding: '6px 12px 8px',
      }}>
        {game.log.length === 0
          ? <div style={{ color: 'var(--main-mute)', fontSize: 12, marginTop: 2 }}>Todavía no hay acciones.</div>
          : game.log.map((line, i) => (
            <div key={i} style={{
              fontSize: 12, lineHeight: 1.5, color: lineColor(line), padding: '2px 0',
              borderBottom: i < game.log.length - 1 ? '1px solid var(--line)' : 'none',
            }}>
              <span style={{ color: 'var(--main-mute)', marginRight: 6 }}>{String(i + 1).padStart(2, '0')}</span>
              {line.replace(/^Setup completado/, 'Despliegue completado')}
            </div>
          ))
        }
      </div>
    </Card>
  );
};
