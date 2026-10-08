import React from 'react';
import { useGameStore } from '../../store/gameStore';
import { HamburgerMenu } from './HamburgerMenu';
import { Card } from '../ui';

const PHASE_LABEL: Record<string, string> = {
  setup: 'Despliegue J.A',
  setupB: 'Despliegue J.B',
  handoffPlay: 'Cambio de turno',
  play: 'En juego',
  finished: 'Partida terminada',
};

export const SystemHeader: React.FC = () => {
  const phase = useGameStore(s => s.game.phase);

  return (
    <Card style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, padding: '8px 10px', flexShrink: 0,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: 'var(--main)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          ⚓ AJEDREZ NAVAL
        </div>
        <div style={{ fontSize: 11, color: 'var(--main-soft)', marginTop: 2 }}>
          {PHASE_LABEL[phase] ?? phase}
        </div>
      </div>
      <div style={{ flexShrink: 0 }}><HamburgerMenu /></div>
    </Card>
  );
};
