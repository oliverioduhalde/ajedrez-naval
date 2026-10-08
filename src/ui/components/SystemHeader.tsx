import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { HamburgerMenu } from './HamburgerMenu';
import { useStackedLayout } from '../hooks/useStackedLayout';

const P  = '#00ff66';
const PD = '#004d1a';

const ReadOut: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 7, color: PD, letterSpacing: 1 }}>{label}</div>
    <div style={{ fontSize: 9, color: '#00cc44', letterSpacing: 1, textShadow: '0 0 6px #00ff66' }}>{value}</div>
  </div>
);

export const SystemHeader: React.FC<{ variant: 'bar' | 'rail' }> = ({ variant }) => {
  const game = useGameStore(s => s.game);
  const stacked = useStackedLayout();

  const phaseLabel: Record<string, string> = {
    setup:       'CONFIG J.A',
    setupB:      'CONFIG J.B',
    handoffPlay: 'TRASPASO',
    play:        `TURNO ${game.turn}`,
    finished:    'MISIÓN COMPLETADA',
  };

  const badge = (
    <div style={{
      fontSize: 8, letterSpacing: 2, color: '#00aa44',
      border: `1px solid ${PD}`, padding: '2px 8px', whiteSpace: 'nowrap',
    }}>
      {phaseLabel[game.phase] ?? game.phase.toUpperCase()}
    </div>
  );

  const logo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span style={{ fontSize: 16, color: P, textShadow: `0 0 10px ${P}` }}>⚓</span>
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 3,
        color: P, textShadow: `0 0 10px ${P}`, whiteSpace: 'nowrap',
      }}>
        AJEDREZ NAVAL
      </div>
    </div>
  );

  if (variant === 'rail') {
    return (
      <div style={{
        border: '1px solid #003311', background: 'rgba(0,15,5,0.85)',
        padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {logo}
          <HamburgerMenu />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {badge}
          <div style={{ display: 'flex', gap: 12 }}>
            <ReadOut label="RADAR" value="ACTIVO" />
            <ReadOut label="SISTEMA" value="ON-LINE" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 12px', height: 42, flexShrink: 0,
      borderBottom: `1px solid ${PD}`, background: 'rgba(0,8,2,0.95)',
      position: 'relative', zIndex: 100, gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {logo}
        {badge}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {!stacked && <ReadOut label="RADAR" value="ACTIVO" />}
        {!stacked && <ReadOut label="SISTEMA" value="ON-LINE" />}
        <HamburgerMenu />
      </div>
    </header>
  );
};
