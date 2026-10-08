import React from 'react';
import { useGameStore } from './store/gameStore';
import { SetupScreen } from './ui/screens/SetupScreen';
import { HandoffScreen } from './ui/screens/HandoffScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { CRTOverlay } from './ui/components/CRTOverlay';
import { HamburgerMenu } from './ui/components/HamburgerMenu';

const P  = '#00ff66';
const PD = '#004d1a';

export default function App() {
  const { game } = useGameStore();

  const phaseLabel: Record<string, string> = {
    setup:       'CONFIG J.A',
    setupB:      'CONFIG J.B',
    handoffPlay: 'TRASPASO',
    play:        `TURNO ${game.turn}`,
    finished:    'MISIÓN COMPLETADA',
  };

  return (
    <CRTOverlay>
      <div style={{
        height: '100vh', width: '100vw',
        display: 'flex', flexDirection: 'column',
        background: '#000a02',
        overflow: 'hidden',
      }}>
        {/* ── Header ─────────────────────────────────────────── */}
        <header style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          height: 42, flexShrink: 0,
          borderBottom: `1px solid ${PD}`,
          background: 'rgba(0,8,2,0.95)',
          position: 'relative', zIndex: 100,
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, color: P, textShadow: `0 0 10px ${P}` }}>⚓</span>
            <div>
              <div style={{
                fontSize: 13, fontWeight: 700, letterSpacing: 4,
                color: P, textShadow: `0 0 10px ${P}`,
              }}>
                AJEDREZ NAVAL
              </div>
            </div>
            {/* Status badge */}
            <div style={{
              fontSize: 8, letterSpacing: 2, color: PD,
              border: `1px solid ${PD}`, padding: '2px 8px', marginLeft: 4,
            }}>
              {phaseLabel[game.phase] ?? game.phase.toUpperCase()}
            </div>
          </div>

          {/* Right: decorative readouts + hamburger */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <ReadOut label="RADAR" value="ACTIVO" />
            <ReadOut label="SISTEMA" value="ON-LINE" />
            <HamburgerMenu />
          </div>
        </header>

        {/* ── Main content ────────────────────────────────────── */}
        <main style={{ flex: 1, overflow: 'hidden', padding: '8px 12px 8px 12px' }}>
          {(game.phase === 'setup' || game.phase === 'setupB') && <SetupScreen />}
          {game.phase === 'handoffPlay' && <HandoffScreen />}
          {(game.phase === 'play' || game.phase === 'finished') && <GameScreen />}
        </main>
      </div>
    </CRTOverlay>
  );
}

const ReadOut: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 7, color: '#004d1a', letterSpacing: 1 }}>{label}</div>
    <div style={{ fontSize: 9, color: '#00cc44', letterSpacing: 1, textShadow: '0 0 6px #00ff66' }}>{value}</div>
  </div>
);
