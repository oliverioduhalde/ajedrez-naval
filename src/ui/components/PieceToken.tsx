import React from 'react';
import type { Piece, Player } from '../../engine/types';
import { pieceLabel } from '../../engine/pieces';
import { canSeeIdentity } from '../../store/gameStore';
import { getUnitIcon } from './PieceIcons';

interface Props {
  piece: Piece;
  viewAs: Player;
  selected?: boolean;
  targetable?: boolean;
  cellSize: number;
  onClick?: () => void;
}

const P = '#00ff66';
const PA = '#00ffaa';
const PD = '#00aa44';

// Player A = brighter green, Player B = amber/orange (enemy on radar)
const COLORS: Record<Player, { primary: string; border: string; glow: string }> = {
  A: { primary: '#00ff66', border: '#00cc44', glow: 'rgba(0,255,100,0.6)' },
  B: { primary: '#ffaa00', border: '#cc8800', glow: 'rgba(255,170,0,0.6)' },
};

export const PieceToken: React.FC<Props> = ({
  piece, viewAs, selected, targetable, cellSize, onClick,
}) => {
  const visible = canSeeIdentity(piece, viewAs);
  const col = COLORS[piece.owner];
  const iconSize = Math.floor(cellSize * 0.55);
  const fontSize = Math.max(6, Math.floor(cellSize * 0.2));

  const borderColor = selected ? '#ffffff' : targetable ? '#ff4444' : col.border;
  const shadow = selected
    ? `0 0 0 1px #fff, 0 0 12px #fff, 0 0 24px ${col.glow}`
    : targetable
    ? `0 0 0 1px #ff4444, 0 0 10px rgba(255,0,0,0.8)`
    : `0 0 6px ${col.glow}`;

  return (
    <div
      onClick={onClick}
      title={visible ? `${piece.type} (J.${piece.owner})${piece.damaged ? ' [AVERIADO]' : ''}` : `CONTACTO DESCONOCIDO (J.${piece.owner})`}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 1,
        cursor: onClick ? 'pointer' : 'default',
        background: selected
          ? `rgba(0,255,100,0.18)`
          : targetable
          ? `rgba(255,50,0,0.15)`
          : `rgba(0,${piece.owner === 'A' ? '20,8' : '15,0'},${piece.owner === 'A' ? '0.85' : '0.85'})`,
        border: `1px solid ${borderColor}`,
        borderRadius: 2,
        boxShadow: shadow,
        transform: piece.damaged ? 'rotate(90deg)' : 'none',
        boxSizing: 'border-box',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
        animation: piece.damaged ? 'phosphor-pulse 2s infinite' : 'none',
      }}
    >
      {/* Phosphor scan line on token */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0.12) 1px, transparent 1px, transparent 3px)',
        pointerEvents: 'none',
        zIndex: 1,
      }} />

      {visible ? (
        <>
          {getUnitIcon(piece.type, iconSize, piece.damaged ? '#ffaa00' : col.primary)}
          <span style={{
            fontSize, fontWeight: 700,
            color: piece.damaged ? '#ffaa00' : col.primary,
            lineHeight: 1,
            textShadow: `0 0 6px ${col.primary}`,
            letterSpacing: '0.5px',
            zIndex: 2,
          }}>
            {pieceLabel(piece.type)}
          </span>
        </>
      ) : (
        <span style={{
          fontSize: Math.floor(cellSize * 0.32),
          fontWeight: 900,
          color: `${col.primary}55`,
          textShadow: `0 0 8px ${col.primary}`,
          zIndex: 2,
        }}>?</span>
      )}
    </div>
  );
};
