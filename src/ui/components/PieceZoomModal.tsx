import React, { useEffect } from 'react';
import type { Player } from '../../engine/types';
import { useGameStore, canSeeIdentity } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { canBeDamaged, canPassMines, getActualRange, getNominalRange, pieceLabel } from '../../engine/pieces';
import { getUnitIcon } from './PieceIcons';
import { PIECE_NAMES, PIECE_ROLE } from '../messages';
import { useSideTones } from '../theme';
import { DamagedFlames } from '../fx/DamagedFlames';
import { mix } from '../ui';

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
    <span style={{ color: 'var(--main-mute)' }}>{label}</span>
    <span style={{ color: 'var(--text)', textAlign: 'right' }}>{value}</span>
  </div>
);

export const PieceZoomModal: React.FC<{ viewAs: Player }> = ({ viewAs }) => {
  const zoomPieceId = useGameStore(s => s.ui.zoomPieceId);
  const pieces = useGameStore(s => s.game.pieces);
  const advanced = useGameStore(s => s.game.options.advancedActualRange);
  const close = useGameStore(s => s.closePieceZoom);
  const size = useSettings(s => s.pieceZoomSize);
  const tones = useSideTones();

  useEffect(() => {
    if (!zoomPieceId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomPieceId, close]);

  const piece = pieces.find(p => p.id === zoomPieceId);
  if (!piece) return null;

  const visible = canSeeIdentity(piece, viewAs);
  const ownerVar = piece.owner === 'A' ? 'var(--main)' : 'var(--rv)';
  const tone = tones[piece.owner];
  const iconColor = piece.damaged ? '#ffb020' : tone.main;
  const nominal = visible ? getNominalRange(piece.type) : 0;
  const actual = visible ? getActualRange(piece) : 0;
  const fmt = (n: number) => (n === Infinity ? 'ilimitado' : `${n} casilla${n === 1 ? '' : 's'}`);
  const canShoot = visible && piece.type !== 'AvionReconocimiento';
  const cardW = Math.min(Math.max(size + 60, 280), window.innerWidth - 24);

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.62)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, overflowY: 'auto',
        cursor: 'zoom-out',
      }}
    >
      <div style={{
        width: cardW, maxHeight: '100%', overflowY: 'auto',
        background: 'var(--panel)', border: `1px solid ${mix(ownerVar, 55)}`, borderRadius: 10,
        padding: 18, animation: 'popin 0.18s ease-out', textAlign: 'center',
      }}>
        <div style={{ position: 'relative', width: size, maxWidth: '100%', margin: '0 auto 12px' }}>
          <div style={{
            width: '100%', height: size, aspectRatio: '1 / 1',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            borderRadius: 12, background: mix(ownerVar, 14), border: `2px solid ${piece.damaged ? 'var(--warn)' : ownerVar}`,
            transform: piece.damaged ? 'rotate(90deg)' : 'none',
          }}>
            {visible ? (
              <>
                {getUnitIcon(piece.type, Math.floor(size * 0.55), iconColor)}
                <span style={{ fontSize: Math.max(14, Math.floor(size * 0.12)), fontWeight: 800, color: piece.damaged ? 'var(--warn)' : ownerVar }}>
                  {pieceLabel(piece.type)}
                </span>
              </>
            ) : (
              <span style={{ fontSize: Math.floor(size * 0.5), fontWeight: 800, color: mix(ownerVar, 65) }}>?</span>
            )}
          </div>
          {visible && piece.damaged && <DamagedFlames cellSize={size} seed={piece.id} contained />}
        </div>

        <div style={{ fontSize: 20, fontWeight: 800, color: ownerVar }}>
          {visible ? PIECE_NAMES[piece.type] : 'Contacto desconocido'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--main-soft)', margin: '2px 0 12px' }}>
          Jugador {piece.owner}{piece.owner === viewAs ? ' (tuyo)' : ' (rival)'}
          {visible && piece.damaged ? ' · averiado' : visible ? ' · ileso' : ''}
        </div>

        <div style={{ textAlign: 'left' }}>
          {piece.pos && <Row label="Posición" value={`fila ${piece.pos.r}, columna ${piece.pos.c}`} />}
          {visible ? (
            <>
              <Row label="Movimiento" value={piece.damaged ? '2 por casilla (averiado)' : '1 por casilla'} />
              <Row
                label={piece.type === 'AvionReconocimiento' ? 'Alcance de reconocimiento' : 'Alcance de tiro'}
                value={piece.damaged && advanced && nominal !== actual ? `${fmt(actual)} (nominal ${fmt(nominal)})` : fmt(nominal)}
              />
              <Row label="Cruza minas" value={canPassMines(piece.type) ? 'Sí' : 'No: una mina lo destruye'} />
              {canBeDamaged(piece.type) && <Row label="Reparación" value="En un taller (⚙)" />}
              {!canShoot && <Row label="Disparo" value="No dispara" />}
              <div style={{ fontSize: 12, color: 'var(--main-soft)', margin: '10px 0 4px', lineHeight: 1.45 }}>{PIECE_ROLE[piece.type]}</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--main-soft)', margin: '10px 0 4px', lineHeight: 1.45 }}>
              No conocés la identidad de esta pieza. Un avión de reconocimiento puede revelarla, o se revela sola si la averiás.
            </div>
          )}
        </div>

        <div style={{ fontSize: 11, color: 'var(--main-mute)', marginTop: 12 }}>
          Verde: alcance de movimiento · Rojo: alcance de tiro. Tocá en cualquier lugar para cerrar.
        </div>
      </div>
    </div>
  );
};
