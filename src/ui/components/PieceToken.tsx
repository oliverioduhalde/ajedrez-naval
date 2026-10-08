import React from 'react';
import type { Piece, Player } from '../../engine/types';
import { pieceLabel } from '../../engine/pieces';
import { canSeeIdentity } from '../../store/gameStore';
import { getUnitIcon } from './PieceIcons';
import { PIECE_NAMES } from '../messages';
import { mix } from '../ui';
import { useSettings } from '../../store/settingsStore';
import { factionOf } from '../../config/factions';

interface Props {
  piece: Piece;
  viewAs: Player;
  selected?: boolean;
  enlarge?: boolean;
  targetable?: boolean;
  cellSize: number;
  onClick?: () => void;
}

export const PieceToken: React.FC<Props> = ({
  piece, viewAs, selected, enlarge, targetable, cellSize, onClick,
}) => {
  const faction = factionOf(useSettings(s => (piece.owner === 'A' ? s.factionA : s.factionB)));
  const ownerVar = piece.owner === 'A' ? 'var(--main)' : 'var(--rv)';
  const visible = canSeeIdentity(piece, viewAs);
  const iconSize = Math.floor(cellSize * 0.55);
  const fontSize = Math.max(8, Math.floor(cellSize * 0.2));
  const accent = piece.damaged ? 'var(--warn)' : ownerVar;
  const iconColor = piece.damaged ? '#ffb020' : faction.glyph;

  const borderColor = selected ? 'var(--text)' : targetable ? 'var(--danger)' : piece.damaged ? 'var(--warn)' : faction.edge;

  return (
    <div
      onClick={onClick}
      title={visible
        ? `${PIECE_NAMES[piece.type]} (J.${piece.owner})${piece.damaged ? ' · averiado' : ''}`
        : `Contacto desconocido (J.${piece.owner})`}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 1,
        cursor: 'pointer',
        background: selected
          ? faction.token(2)
          : targetable
          ? mix('var(--danger)', 18)
          : faction.token(1),
        border: `${selected ? 2 : 1}px solid ${borderColor}`,
        borderRadius: 4,
        boxShadow: selected ? `0 0 0 2px ${mix(faction.edge, 45)}` : 'none',
        transform: `${piece.damaged ? 'rotate(90deg) ' : ''}${selected && enlarge ? 'scale(1.14)' : 'scale(1)'}`,
        transition: 'transform 0.15s ease, background 0.15s ease',
        zIndex: selected ? 3 : 1,
        boxSizing: 'border-box',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
        animation: piece.damaged ? 'pulse 2.2s infinite' : 'none',
      }}
    >
      {visible ? (
        <>
          <span style={{ display: 'flex', filter: faction.shadowGlyph ? 'drop-shadow(0 0 2px rgba(0,0,0,0.9))' : undefined }}>
            {getUnitIcon(piece.type, iconSize, iconColor)}
          </span>
          <span style={{
            fontSize, fontWeight: 700, color: accent, lineHeight: 1, letterSpacing: '0.3px',
          }}>
            {pieceLabel(piece.type)}
          </span>
        </>
      ) : (
        <span style={{ fontSize: Math.floor(cellSize * 0.34), fontWeight: 800, color: mix(ownerVar, 65) }}>?</span>
      )}
    </div>
  );
};
