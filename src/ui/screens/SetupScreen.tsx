import React, { useState } from 'react';
import { useGameStore, canSeeIdentity } from '../../store/gameStore';
import { pieceLabel } from '../../engine/pieces';
import { getCellKind, getSetupCells } from '../../engine/board';
import { getUnitIcon } from '../components/PieceIcons';
import { RadarCanvas } from '../components/RadarCanvas';
import { BoardViewport } from '../components/BoardViewport';
import { useStackedLayout } from '../hooks/useStackedLayout';
import { displayDims, mapCell, mapRect, mapSide, sideBorder } from '../boardRotation';
import type { Piece } from '../../engine/types';

const P  = '#00ff66';
const AM = '#ffaa00';
const COLS = 24;
const ROWS = 20;

const CELL_BG: Record<string, string> = {
  sea: 'transparent', island: 'rgba(0,60,10,0.95)',
  workshop: 'rgba(0,80,20,0.85)', bay: 'rgba(0,60,25,0.7)',
  arrivalA: 'rgba(0,40,12,0.7)', arrivalB: 'rgba(30,10,0,0.7)',
};

const cells: { r: number; c: number }[] = [];
for (let r = 1; r <= ROWS; r++)
  for (let c = 1; c <= COLS; c++)
    cells.push({ r, c });

export const SetupScreen: React.FC = () => {
  const { game, ui, placePiece, finishSetup, clearError } = useGameStore();
  const stacked = useStackedLayout();
  const player = game.setupPlayer;
  const myPieces = game.pieces.filter(p => p.owner === player);
  const unplaced  = myPieces.filter(p => p.pos === null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const validCells = getSetupCells(player);
  const validSet   = new Set(validCells.map(c => `${c.r},${c.c}`));
  const pieceMap   = new Map<string, Piece>();
  for (const p of game.pieces) if (p.pos) pieceMap.set(`${p.pos.r},${p.pos.c}`, p);

  const allPlaced  = unplaced.length === 0;
  const color      = player === 'A' ? P : AM;

  function handleCell(r: number, c: number) {
    if (!selectedId || !validSet.has(`${r},${c}`)) return;
    if (!pieceMap.has(`${r},${c}`)) {
      placePiece(selectedId, { r, c });
      setSelectedId(null);
    }
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: stacked ? 'column' : 'row',
      gap: 8, overflow: 'hidden',
    }}>
      <BoardViewport cols={COLS} rows={ROWS}>
        {(cellSize, rot) => {
          const { dc, dr } = displayDims(rot, COLS, ROWS);
          const boardW = cellSize * dc;
          const boardH = cellSize * dr;
          const foldSide = mapSide(rot, 'right');
          const zoneA = mapRect(rot, 1, 1, 7, COLS, COLS, ROWS);
          const zoneB = mapRect(rot, 14, 1, 20, COLS, COLS, ROWS);
          return (
            <div style={{
              position: 'absolute', inset: 0, overflow: 'hidden',
              border: `1px solid rgba(0,255,80,0.2)`,
              boxShadow: `0 0 30px rgba(0,255,80,0.06)`,
            }}>
              <RadarCanvas width={boardW} height={boardH} />

              {cells.map(({ r, c }) => {
                const kind   = getCellKind(r, c);
                const key    = `${r},${c}`;
                const piece  = pieceMap.get(key);
                const isVT   = validSet.has(key) && selectedId !== null && !piece;
                const { row, col } = mapCell(rot, r, c, COLS, ROWS);

                const bg  = isVT ? 'rgba(0,255,100,0.12)' : (CELL_BG[kind] ?? 'transparent');
                const bdr = isVT ? 'rgba(0,255,100,0.4)' : 'rgba(0,200,80,0.06)';
                const border: Record<string, string> = {
                  borderRight: `1px solid ${bdr}`,
                  borderBottom: `1px solid ${bdr}`,
                };
                if (c === 12) border[sideBorder(foldSide)] = '1px solid rgba(0,255,80,0.2)';

                return (
                  <div
                    key={key}
                    onClick={() => handleCell(r, c)}
                    style={{
                      position: 'absolute',
                      left: (col - 1) * cellSize, top: (row - 1) * cellSize,
                      width: cellSize, height: cellSize,
                      backgroundColor: bg,
                      boxSizing: 'border-box',
                      ...border,
                      cursor: isVT ? 'crosshair' : 'default',
                      zIndex: 1,
                    }}
                  >
                    {kind === 'island' && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'repeating-linear-gradient(45deg, rgba(0,100,20,0.35) 0, rgba(0,100,20,0.35) 2px, transparent 2px, transparent 5px)',
                        pointerEvents: 'none',
                      }} />
                    )}
                    {isVT && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div style={{
                          width: cellSize * 0.28, height: cellSize * 0.28, borderRadius: '50%',
                          background: P, boxShadow: `0 0 8px ${P}`,
                          animation: 'phosphor-pulse 1s infinite',
                        }} />
                      </div>
                    )}
                    {piece && (
                      <div style={{
                        position: 'absolute', inset: 1,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 1,
                        border: `1px solid ${piece.owner === 'A' ? '#004d1a' : '#553300'}`,
                        background: piece.owner === 'A' ? 'rgba(0,20,8,0.9)' : 'rgba(20,8,0,0.9)',
                      }}>
                        {canSeeIdentity(piece, player)
                          ? getUnitIcon(piece.type, Math.floor(cellSize * 0.5), piece.owner === 'A' ? P : AM)
                          : <span style={{ fontSize: Math.floor(cellSize * 0.3), color: '#004d1a' }}>?</span>
                        }
                        {cellSize > 22 && canSeeIdentity(piece, player) && (
                          <span style={{ fontSize: 6, color: piece.owner === 'A' ? '#00aa44' : '#aa7700', letterSpacing: 0 }}>
                            {pieceLabel(piece.type)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {cellSize >= 24 && (
                <>
                  <div style={{
                    position: 'absolute',
                    left: zoneA.left * cellSize, top: zoneA.top * cellSize,
                    width: zoneA.width * cellSize, height: zoneA.height * cellSize,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none', zIndex: 2,
                    fontSize: 8, letterSpacing: 4, color: player === 'A' ? 'rgba(0,255,80,0.35)' : 'rgba(0,255,80,0.1)',
                  }}>ZONA J.A</div>
                  <div style={{
                    position: 'absolute',
                    left: zoneB.left * cellSize, top: zoneB.top * cellSize,
                    width: zoneB.width * cellSize, height: zoneB.height * cellSize,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none', zIndex: 2,
                    fontSize: 8, letterSpacing: 4, color: player === 'B' ? 'rgba(255,150,0,0.35)' : 'rgba(255,150,0,0.1)',
                  }}>ZONA J.B</div>
                </>
              )}
            </div>
          );
        }}
      </BoardViewport>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        width: stacked ? '100%' : 'clamp(200px, 24vw, 260px)', flexShrink: 0,
        maxHeight: stacked ? '44%' : undefined,
        overflowY: 'auto',
      }}>
        <div style={{
          border: `1px solid ${color}33`, padding: '8px 10px',
          background: 'rgba(0,10,2,0.9)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, border: `1px solid ${color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 700, color,
              boxShadow: `0 0 8px ${color}`, flexShrink: 0,
            }}>{player}</div>
            <div>
              <div style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: 1.5 }}>
                JUGADOR {player}
              </div>
              <div style={{ fontSize: 9, color: '#00aa44', letterSpacing: 1, marginTop: 1 }}>
                DESPLIEGUE DE FLOTA
              </div>
            </div>
          </div>
          <div style={{ fontSize: 9, color: '#005522', letterSpacing: 1, marginTop: 8 }}>
            ZONA: FILAS {player === 'A' ? '01–07' : '14–20'}<br />
            {unplaced.length > 0 ? `${16 - unplaced.length}/16 DESPLEGADAS` : '✓ FLOTA LISTA'}
          </div>
          {ui.errorMessage && (
            <div onClick={clearError} style={{
              marginTop: 8, fontSize: 9, color: '#ff4444', cursor: 'pointer',
              border: '1px solid #ff4444', padding: '2px 6px',
              boxShadow: '0 0 6px rgba(255,0,0,0.3)',
            }}>
              ▸ ERR: {ui.errorMessage}
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4,
          border: '1px solid #003311', padding: '6px 8px',
          background: 'rgba(0,8,2,0.9)',
        }}>
          {unplaced.map(p => {
            const isSel = p.id === selectedId;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(isSel ? null : p.id)}
                title={p.type}
                style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 2, padding: '4px 6px',
                  border: `1px solid ${isSel ? color : '#003311'}`,
                  background: isSel ? `${color}18` : 'transparent',
                  cursor: 'pointer', minWidth: 38,
                  boxShadow: isSel ? `0 0 8px ${color}` : 'none',
                  transition: 'all 0.1s',
                  color: isSel ? color : '#006622',
                }}
              >
                {getUnitIcon(p.type, 18, isSel ? color : '#006622')}
                <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 0.5 }}>
                  {pieceLabel(p.type)}
                </span>
              </button>
            );
          })}
          {allPlaced && (
            <span style={{ color: P, fontSize: 10, letterSpacing: 2, padding: '4px 0' }}>
              ▸ FLOTA DESPLEGADA
            </span>
          )}
        </div>

        <button
          disabled={!allPlaced}
          onClick={() => finishSetup()}
          style={{
            padding: '10px 12px', flexShrink: 0,
            border: `1px solid ${allPlaced ? color : '#002d12'}`,
            background: 'transparent', color: allPlaced ? color : '#003311',
            cursor: allPlaced ? 'pointer' : 'not-allowed',
            fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
            boxShadow: allPlaced ? `0 0 10px ${color}30` : 'none',
            textShadow: allPlaced ? `0 0 8px ${color}` : 'none',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (allPlaced) e.currentTarget.style.background = `${color}12`; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          ▸ {game.phase === 'setup' ? 'LISTO — PASAR A JUGADOR B' : 'LISTO — INICIAR MISIÓN'}
        </button>
      </div>
    </div>
  );
};
