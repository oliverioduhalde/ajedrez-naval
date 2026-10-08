import React, { useState } from 'react';
import { useGameStore, canSeeIdentity } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { pieceLabel } from '../../engine/pieces';
import { getCellKind, getSetupCells } from '../../engine/board';
import { getUnitIcon } from '../components/PieceIcons';
import { RadarCanvas } from '../components/RadarCanvas';
import { BoardViewport, ViewControls } from '../components/BoardViewport';
import { SystemHeader } from '../components/SystemHeader';
import { useStackedLayout } from '../hooks/useStackedLayout';
import { displayDims, mapCell, mapRect, mapSide, sideBorder } from '../boardRotation';
import { PIECE_NAMES } from '../messages';
import { useSideTones } from '../theme';
import { Btn, Card, Label, mix } from '../ui';
import type { Piece } from '../../engine/types';

const COLS = 24;
const ROWS = 20;

type DeployMode = 'manual' | 'random' | 'taskforce';

const MODE_INFO: Record<DeployMode, string> = {
  manual: 'Elegí una pieza de la bandeja y tocá una casilla de tu zona. Tocá una pieza colocada para devolverla a la bandeja.',
  random: 'Reparte las 16 piezas al azar dentro de tu zona de salida. Podés repetir el sorteo.',
  taskforce: 'Forma 3 grupos de combate en la zona de salida: uno central pesado con el acorazado y dos de flanco, con los aviones atrás.',
};

const cells: { r: number; c: number }[] = [];
for (let r = 1; r <= ROWS; r++)
  for (let c = 1; c <= COLS; c++)
    cells.push({ r, c });

export const SetupScreen: React.FC = () => {
  const { game, ui, placePiece, unplacePiece, deployFleet, finishSetup, clearError } = useGameStore();
  const stacked = useStackedLayout();
  const tones = useSideTones();
  const player = game.setupPlayer;
  const vsCpu = useSettings(s => s.vsCpu);
  const viewer = vsCpu ? 'A' : player;
  const cpuDeploying = vsCpu && player === 'B';
  const myPieces = game.pieces.filter(p => p.owner === player);
  const unplaced = myPieces.filter(p => p.pos === null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<DeployMode>('manual');

  const validCells = getSetupCells(player);
  const validSet = new Set(validCells.map(c => `${c.r},${c.c}`));
  const pieceMap = new Map<string, Piece>();
  for (const p of game.pieces) if (p.pos) pieceMap.set(`${p.pos.r},${p.pos.c}`, p);

  const allPlaced = unplaced.length === 0;
  const sideVar = player === 'A' ? 'var(--main)' : 'var(--rv)';
  const sideTone = tones[player];

  function pickMode(m: DeployMode) {
    setMode(m);
    setSelectedId(null);
    if (m === 'random' || m === 'taskforce') deployFleet(m);
  }

  function handleCell(r: number, c: number) {
    const here = pieceMap.get(`${r},${c}`);
    if (here) {
      if (here.owner === player && !selectedId) unplacePiece(here.id);
      return;
    }
    if (!selectedId || !validSet.has(`${r},${c}`)) return;
    placePiece(selectedId, { r, c });
    setSelectedId(null);
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: stacked ? 'column' : 'row',
      gap: 4, overflow: 'hidden',
    }}>
      <BoardViewport cols={COLS} rows={ROWS}>
        {(cellSize, rot) => {
          const { dc, dr } = displayDims(rot, COLS, ROWS);
          const boardW = cellSize * dc;
          const boardH = cellSize * dr;
          const foldSide = mapSide(rot, 'right');
          const zoneA = mapRect(rot, 1, 1, 7, COLS, COLS, ROWS);
          const zoneB = mapRect(rot, 14, 1, 20, COLS, COLS, ROWS);
          const zoneLabel = (rect: typeof zoneA, text: string, active: boolean, colorVar: string) => (
            <div style={{
              position: 'absolute',
              left: rect.left * cellSize, top: rect.top * cellSize,
              width: rect.width * cellSize, height: rect.height * cellSize,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', zIndex: 2,
              fontSize: 11, letterSpacing: 3, fontWeight: 700,
              color: mix(colorVar, active ? 40 : 14),
            }}>{text}</div>
          );
          return (
            <div style={{
              position: 'absolute', inset: 0, overflow: 'hidden',
              border: `1px solid ${mix('var(--sea)', 45)}`,
            }}>
              <RadarCanvas width={boardW} height={boardH} />

              {cells.map(({ r, c }) => {
                const kind = getCellKind(r, c);
                const key = `${r},${c}`;
                const piece = pieceMap.get(key);
                const isVT = validSet.has(key) && selectedId !== null && !piece;
                const { row, col } = mapCell(rot, r, c, COLS, ROWS);

                const bg = isVT ? mix(sideVar, 20)
                  : kind === 'island' ? mix('var(--sea)', 18)
                  : kind === 'workshop' ? mix('var(--sea)', 26)
                  : kind === 'bay' ? mix('var(--sea)', 12)
                  : kind === 'arrivalA' ? mix('var(--main)', 9)
                  : kind === 'arrivalB' ? mix('var(--rv)', 9)
                  : 'transparent';
                const bdr = isVT ? mix(sideVar, 55) : mix('var(--sea)', 20);
                const border: Record<string, string> = {
                  borderRight: `1px solid ${bdr}`,
                  borderBottom: `1px solid ${bdr}`,
                };
                if (c === 12) border[sideBorder(foldSide)] = `1px solid ${mix('var(--sea)', 45)}`;

                const own = piece && piece.owner === player;
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
                      cursor: isVT ? 'crosshair' : own && !selectedId ? 'pointer' : 'default',
                      zIndex: 1,
                    }}
                  >
                    {kind === 'island' && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: `repeating-linear-gradient(45deg, ${mix('var(--sea)', 30)} 0, ${mix('var(--sea)', 30)} 2px, transparent 2px, transparent 6px)`,
                        pointerEvents: 'none',
                      }} />
                    )}
                    {isVT && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{
                          width: cellSize * 0.28, height: cellSize * 0.28, borderRadius: '50%',
                          background: sideVar, animation: 'pulse 1.2s infinite',
                        }} />
                      </div>
                    )}
                    {piece && (
                      <div
                        title={own ? 'Tocá para devolver a la bandeja' : undefined}
                        style={{
                          position: 'absolute', inset: 2,
                          display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 4,
                          border: `1px solid ${mix(piece.owner === 'A' ? 'var(--main)' : 'var(--rv)', 55)}`,
                          background: mix(piece.owner === 'A' ? 'var(--main)' : 'var(--rv)', 12),
                        }}
                      >
                        {canSeeIdentity(piece, viewer)
                          ? getUnitIcon(piece.type, Math.floor(cellSize * 0.5), tones[piece.owner].main)
                          : <span style={{ fontSize: Math.floor(cellSize * 0.34), fontWeight: 800, color: mix(piece.owner === 'A' ? 'var(--main)' : 'var(--rv)', 65) }}>?</span>
                        }
                        {cellSize > 26 && canSeeIdentity(piece, viewer) && (
                          <span style={{ fontSize: 9, color: tones[piece.owner].soft, fontWeight: 700 }}>
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
                  {zoneLabel(zoneA, 'ZONA J.A', player === 'A', 'var(--main)')}
                  {zoneLabel(zoneB, 'ZONA J.B', player === 'B', 'var(--rv)')}
                </>
              )}
            </div>
          );
        }}
      </BoardViewport>

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        width: stacked ? '100%' : 'clamp(220px, 24vw, 280px)', flexShrink: 0,
        maxHeight: stacked ? '46%' : undefined,
        overflowY: 'auto', paddingRight: 2,
      }}>
        <SystemHeader />

        <Card style={{ padding: '8px 10px' }}>
          <Label>Vista del tablero</Label>
          <div style={{ marginTop: 6 }}><ViewControls /></div>
        </Card>

        <Card style={{ borderColor: mix(sideVar, 40) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, border: `2px solid ${sideVar}`, borderRadius: 6, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 800, color: sideVar, background: mix(sideVar, 14),
            }}>{player}</div>
            <div>
              <div style={{ fontSize: 14, color: sideVar, fontWeight: 700 }}>
                {vsCpu && player === 'B' ? 'CPU' : `Jugador ${player}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--main-soft)' }}>Despliegue de la flota</div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--main-mute)', marginTop: 8 }}>
            Zona de salida: filas {player === 'A' ? '1 a 7' : '14 a 20'}<br />
            {unplaced.length > 0 ? `${16 - unplaced.length} de 16 piezas desplegadas` : 'Flota completa'}
          </div>
          {ui.errorMessage && (
            <div onClick={clearError} style={{
              marginTop: 8, fontSize: 12, color: 'var(--danger)', cursor: 'pointer',
              border: '1px solid var(--danger)', borderRadius: 4, padding: '4px 8px',
            }}>
              {ui.errorMessage}
            </div>
          )}
        </Card>

        {cpuDeploying ? (
          <Card>
            <div style={{ fontSize: 13, color: 'var(--rv)', animation: 'pulse 1s infinite' }}>
              La CPU está desplegando su flota…
            </div>
          </Card>
        ) : (
          <>
            <Card>
              <Label>Disposición</Label>
              <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden', margin: '8px 0' }}>
                {([['manual', 'Manual'], ['random', 'Aleatoria'], ['taskforce', 'Task force']] as [DeployMode, string][]).map(([m, label], i) => (
                  <button
                    key={m}
                    onClick={() => pickMode(m)}
                    style={{
                      flex: 1, padding: '8px 2px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      background: mode === m ? mix(sideVar, 20) : 'transparent',
                      color: mode === m ? sideVar : 'var(--main-soft)',
                      border: 'none', borderLeft: i === 0 ? 'none' : '1px solid var(--line)',
                    }}
                  >{label}</button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--main-mute)', lineHeight: 1.4 }}>{MODE_INFO[mode]}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {mode === 'random' && <Btn onClick={() => deployFleet('random')} style={{ textAlign: 'center' }}>Sortear de nuevo</Btn>}
                <Btn onClick={() => { setSelectedId(null); deployFleet('clear'); }} disabled={unplaced.length === 16} style={{ textAlign: 'center' }}>
                  Limpiar flota
                </Btn>
              </div>
            </Card>

            <Card>
              <Label>Bandeja de piezas</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {unplaced.map(p => {
                  const isSel = p.id === selectedId;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedId(isSel ? null : p.id)}
                      title={PIECE_NAMES[p.type]}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                        padding: '5px 6px', minWidth: 42, borderRadius: 4, cursor: 'pointer',
                        border: `1px solid ${isSel ? sideVar : 'var(--line)'}`,
                        background: isSel ? mix(sideVar, 20) : 'transparent',
                        color: isSel ? sideVar : 'var(--main-soft)',
                      }}
                    >
                      {getUnitIcon(p.type, 20, isSel ? sideTone.main : sideTone.soft)}
                      <span style={{ fontSize: 10, fontWeight: 700 }}>{pieceLabel(p.type)}</span>
                    </button>
                  );
                })}
                {allPlaced && (
                  <span style={{ color: sideVar, fontSize: 13, padding: '4px 0' }}>Toda la flota está en el mar.</span>
                )}
              </div>
            </Card>

            <button
              disabled={!allPlaced}
              onClick={() => { setSelectedId(null); finishSetup(); }}
              style={{
                padding: '12px', flexShrink: 0, borderRadius: 4, fontSize: 14, fontWeight: 700,
                border: `1px solid ${allPlaced ? sideVar : 'var(--line)'}`,
                background: allPlaced ? mix(sideVar, 14) : 'transparent',
                color: allPlaced ? sideVar : 'var(--main-mute)',
                cursor: allPlaced ? 'pointer' : 'not-allowed',
              }}
            >
              {game.phase === 'setup'
                ? (vsCpu ? 'Listo: enfrentar a la CPU' : 'Listo: pasar al jugador B')
                : 'Listo: iniciar la partida'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
