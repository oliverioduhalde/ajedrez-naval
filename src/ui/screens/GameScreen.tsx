import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { Board } from '../components/Board';
import { ActionPanel } from '../components/ActionPanel';
import { GameLog } from '../components/GameLog';
import { SystemHeader } from '../components/SystemHeader';
import { useStackedLayout } from '../hooks/useStackedLayout';

const P = '#00ff66';
const AM = '#ffaa00';

export const GameScreen: React.FC = () => {
  const { game, resetGame } = useGameStore();
  const stacked = useStackedLayout();
  const viewAs = game.turn;

  if (game.phase === 'finished') {
    const winner = game.winner!;
    const color = winner === 'A' ? P : AM;
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 24, overflowY: 'auto',
      }}>
        <div style={{ width: 'min(420px, 100%)' }}>
          <SystemHeader variant="rail" />
        </div>
        <div style={{
          border: `1px solid ${color}`,
          background: 'rgba(0,10,2,0.96)',
          padding: '40px 60px', textAlign: 'center',
          boxShadow: `0 0 60px ${color}40`,
          position: 'relative',
        }}>
          {/* Corner ticks */}
          {[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy], i) => (
            <div key={i} style={{
              position: 'absolute',
              top: sy < 0 ? -1 : 'auto', bottom: sy > 0 ? -1 : 'auto',
              left: sx < 0 ? -1 : 'auto', right: sx > 0 ? -1 : 'auto',
              width: 12, height: 12,
              borderTop: sy < 0 ? `2px solid ${color}` : 'none',
              borderBottom: sy > 0 ? `2px solid ${color}` : 'none',
              borderLeft: sx < 0 ? `2px solid ${color}` : 'none',
              borderRight: sx > 0 ? `2px solid ${color}` : 'none',
            }} />
          ))}

          <div style={{ fontSize: 9, letterSpacing: 4, color: `${color}80`, marginBottom: 12 }}>
            ── CONTACTO CONFIRMADO ──
          </div>
          <div style={{
            fontSize: 32, fontWeight: 700, color,
            textShadow: `0 0 20px ${color}, 0 0 40px ${color}80`,
            letterSpacing: 4,
            animation: 'phosphor-pulse 1.5s infinite',
          }}>
            JUGADOR {winner} GANA
          </div>
          <div style={{ fontSize: 10, color: `${color}60`, marginTop: 8, letterSpacing: 2 }}>
            INVASIÓN COMPLETADA — ZONA TOMADA
          </div>
          <button
            onClick={() => resetGame()}
            style={{
              marginTop: 28, padding: '10px 32px',
              border: `1px solid ${color}`, background: 'transparent',
              color, cursor: 'pointer', fontSize: 11,
              letterSpacing: 3, textTransform: 'uppercase',
              boxShadow: `0 0 12px ${color}40`,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = `${color}20`}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            ↺ NUEVA MISIÓN
          </button>
        </div>
        <GameLog />
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: 8,
      height: '100%', overflow: 'hidden',
    }}>
      <Board viewAs={viewAs} />

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        width: stacked ? '100%' : 'clamp(200px, 24vw, 260px)', flexShrink: 0,
        maxHeight: stacked ? '42%' : undefined,
        overflowY: 'auto',
      }}>
        <SystemHeader variant="rail" />
        <ActionPanel viewAs={viewAs} />
        <GameLog fill />
      </div>
    </div>
  );
};
