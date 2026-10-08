import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';

export const HandoffScreen: React.FC = () => {
  const { game, confirmHandoff } = useGameStore();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const PINS: Record<string, string> = { A: '1111', B: '2222' };
  const next = game.turn;
  const color = next === 'A' ? '#00ff66' : '#ffaa00';

  function go() {
    if (game.options.presentation.handoffPin && pin !== PINS[next]) { setErr(true); return; }
    confirmHandoff();
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%',
    }}>
      <div style={{
        border: `1px solid ${color}44`,
        background: 'rgba(0,8,2,0.97)',
        padding: '44px 56px', textAlign: 'center',
        boxShadow: `0 0 60px ${color}15`,
        position: 'relative', maxWidth: 380, width: '90vw',
      }}>
        {/* corner ticks */}
        {[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy], i) => (
          <div key={i} style={{
            position: 'absolute',
            top: sy < 0 ? -1 : 'auto', bottom: sy > 0 ? -1 : 'auto',
            left: sx < 0 ? -1 : 'auto', right: sx > 0 ? -1 : 'auto',
            width: 10, height: 10,
            borderTop: sy < 0 ? `1px solid ${color}` : 'none',
            borderBottom: sy > 0 ? `1px solid ${color}` : 'none',
            borderLeft: sx < 0 ? `1px solid ${color}` : 'none',
            borderRight: sx > 0 ? `1px solid ${color}` : 'none',
          }} />
        ))}

        <div style={{ fontSize: 8, letterSpacing: 4, color: `${color}60`, marginBottom: 16 }}>
          ── CAMBIO DE TURNO ──
        </div>
        <div style={{ fontSize: 11, letterSpacing: 3, color: '#005522', marginBottom: 6 }}>
          OPERADOR EN CONTROL:
        </div>
        <div style={{
          fontSize: 28, fontWeight: 700, color,
          textShadow: `0 0 16px ${color}`,
          letterSpacing: 4, marginBottom: 6,
        }}>
          JUGADOR {next}
        </div>
        <div style={{ fontSize: 9, color: '#004d1a', letterSpacing: 2, marginBottom: 24 }}>
          PASAR DISPOSITIVO — AGUARDAR CONFIRMACIÓN
        </div>

        {game.options.presentation.handoffPin && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 9, color: '#005522', letterSpacing: 2, marginBottom: 8 }}>
              CÓDIGO DE ACCESO J.{next}:
            </div>
            <input
              type="password"
              value={pin}
              onChange={e => { setPin(e.target.value); setErr(false); }}
              placeholder="····"
              style={{
                padding: '8px 16px',
                border: `1px solid ${err ? '#ff4444' : '#003311'}`,
                background: '#000a02',
                color,
                fontSize: 18, textAlign: 'center', letterSpacing: 8,
                width: 120, outline: 'none',
                boxShadow: err ? '0 0 8px rgba(255,0,0,0.4)' : 'none',
              }}
            />
            {err && <div style={{ color: '#ff4444', fontSize: 9, marginTop: 6, letterSpacing: 2 }}>
              ▸ ACCESO DENEGADO
            </div>}
          </div>
        )}

        <button
          onClick={go}
          style={{
            padding: '10px 32px', width: '100%',
            border: `1px solid ${color}88`,
            background: 'transparent', color,
            cursor: 'pointer', fontSize: 11, letterSpacing: 3,
            textTransform: 'uppercase',
            textShadow: `0 0 8px ${color}`,
            boxShadow: `0 0 12px ${color}20`,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = `${color}12`}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          ▸ CONFIRMAR ACCESO
        </button>
      </div>
    </div>
  );
};
