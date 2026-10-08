import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { SystemHeader } from '../components/SystemHeader';
import { Card, mix } from '../ui';

export const HandoffScreen: React.FC = () => {
  const { game, confirmHandoff } = useGameStore();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const PINS: Record<string, string> = { A: '1111', B: '2222' };
  const next = game.turn;
  const color = next === 'A' ? 'var(--main)' : 'var(--rv)';

  function go() {
    if (game.options.presentation.handoffPin && pin !== PINS[next]) { setErr(true); return; }
    confirmHandoff();
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', gap: 12, padding: 12, overflowY: 'auto',
    }}>
      <div style={{ width: 'min(420px, 100%)' }}>
        <SystemHeader />
      </div>

      <Card style={{ width: 'min(420px, 100%)', padding: '32px 28px', textAlign: 'center', borderColor: mix(color, 45) }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: 'var(--main-mute)', marginBottom: 14, textTransform: 'uppercase' }}>
          Cambio de turno
        </div>
        <div style={{ fontSize: 13, color: 'var(--main-soft)', marginBottom: 6 }}>Le toca a</div>
        <div style={{ fontSize: 30, fontWeight: 800, color, marginBottom: 8 }}>
          Jugador {next}
        </div>
        <div style={{ fontSize: 12, color: 'var(--main-mute)', marginBottom: 22 }}>
          Pasá el dispositivo y confirmá cuando esté listo.
        </div>

        {game.options.presentation.handoffPin && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--main-soft)', marginBottom: 8 }}>
              Código de acceso del jugador {next}
            </div>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => { setPin(e.target.value); setErr(false); }}
              placeholder="····"
              style={{
                padding: '8px 14px', borderRadius: 4,
                border: `1px solid ${err ? 'var(--danger)' : 'var(--line)'}`,
                background: 'var(--bg)', color,
                fontSize: 20, textAlign: 'center', letterSpacing: 8, width: 140, outline: 'none',
              }}
            />
            {err && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>Código incorrecto.</div>}
          </div>
        )}

        <button
          onClick={go}
          style={{
            padding: '12px 24px', width: '100%', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${color}`, background: mix(color, 12), color,
            fontSize: 14, fontWeight: 700, letterSpacing: 1,
          }}
        >
          Confirmar y comenzar mi turno
        </button>
      </Card>
    </div>
  );
};
