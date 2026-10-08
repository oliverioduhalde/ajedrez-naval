import React, { useMemo } from 'react';
import type { Player } from '../../engine/types';
import { getCellKind } from '../../engine/board';
import { useGameStore } from '../../store/gameStore';
import { PieceToken } from './PieceToken';
import { RadarCanvas } from './RadarCanvas';
import { BoardViewport } from './BoardViewport';
import { IconMine } from './PieceIcons';
import { boardConfig } from '../../config/boardConfig';
import { displayDims, mapCell, mapRect, mapSide, sideBorder, type Rot, type Side } from '../boardRotation';

const COLS = boardConfig.cols;
const ROWS = boardConfig.rows;

function cellBg(kind: string, highlighted: boolean, targetable: boolean): string {
  if (highlighted)  return 'rgba(0,255,100,0.18)';
  if (targetable)   return 'rgba(255,30,0,0.18)';
  switch (kind) {
    case 'island':   return 'rgba(0,60,10,0.95)';
    case 'workshop': return 'rgba(0,80,20,0.85)';
    case 'bay':      return 'rgba(0,60,25,0.7)';
    case 'arrivalA': return 'rgba(0,40,12,0.7)';
    case 'arrivalB': return 'rgba(30,10,0,0.7)';
    default:         return 'transparent';
  }
}

function cellBorder(kind: string, highlighted: boolean, targetable: boolean): string {
  if (highlighted) return 'rgba(0,255,100,0.5)';
  if (targetable)  return 'rgba(255,50,0,0.5)';
  switch (kind) {
    case 'island':   return 'rgba(0,150,50,0.4)';
    case 'workshop': return 'rgba(0,255,80,0.35)';
    case 'bay':      return 'rgba(0,200,60,0.2)';
    case 'arrivalA': return 'rgba(0,255,80,0.25)';
    case 'arrivalB': return 'rgba(200,100,0,0.3)';
    default:         return 'rgba(0,200,80,0.06)';
  }
}

function stripeStyle(side: Side, color: string): React.CSSProperties {
  const base: React.CSSProperties = { position: 'absolute', background: color, pointerEvents: 'none' };
  if (side === 'top')    return { ...base, top: 0, left: 0, right: 0, height: 2 };
  if (side === 'bottom') return { ...base, bottom: 0, left: 0, right: 0, height: 2 };
  if (side === 'left')   return { ...base, left: 0, top: 0, bottom: 0, width: 2 };
  return { ...base, right: 0, top: 0, bottom: 0, width: 2 };
}

function columnLabelStyle(rot: Rot, cellSize: number, dc: number, dr: number, row: number, col: number): React.CSSProperties {
  const side = mapSide(rot, 'top');
  const common: React.CSSProperties = {
    position: 'absolute', fontSize: 7, color: 'rgba(0,255,80,0.25)',
    pointerEvents: 'none', letterSpacing: 0,
  };
  if (side === 'top')    return { ...common, left: (col - 1) * cellSize, top: -14, width: cellSize, textAlign: 'center' };
  if (side === 'bottom') return { ...common, left: (col - 1) * cellSize, top: dr * cellSize + 3, width: cellSize, textAlign: 'center' };
  if (side === 'left')   return { ...common, left: -14, top: (row - 1) * cellSize, height: cellSize, lineHeight: `${cellSize}px`, width: 12, textAlign: 'right' };
  return { ...common, left: dc * cellSize + 3, top: (row - 1) * cellSize, height: cellSize, lineHeight: `${cellSize}px`, width: 12 };
}

interface Props { viewAs: Player; locked?: boolean }

export const Board: React.FC<Props> = ({ viewAs, locked }) => {
  const { game, ui, selectPiece, doMove, doAttack, doRecon, doPlaceMine, doLiftMine } = useGameStore();

  const highlightSet = useMemo(
    () => new Set(ui.highlightedCells.map(c => `${c.r},${c.c}`)),
    [ui.highlightedCells],
  );
  const mineMap  = useMemo(() => new Map(game.mines.map(m => [`${m.r},${m.c}`, m.owner])), [game.mines]);
  const pieceMap = useMemo(() => {
    const map = new Map<string, typeof game.pieces[0]>();
    for (const p of game.pieces) if (p.pos) map.set(`${p.pos.r},${p.pos.c}`, p);
    return map;
  }, [game.pieces]);
  const targetSet = useMemo(() => new Set(ui.targetablePieceIds), [ui.targetablePieceIds]);

  function handleCellClick(r: number, c: number) {
    if (locked) return;
    const piece = pieceMap.get(`${r},${c}`);
    if (ui.mode === 'moving' || ui.mode === 'idle') {
      if (piece?.owner === game.turn) { selectPiece(piece.id); return; }
      if (ui.selectedPieceId && highlightSet.has(`${r},${c}`)) { doMove({ r, c }); return; }
      selectPiece(null);
    } else if (ui.mode === 'attacking'  && piece && targetSet.has(piece.id)) { doAttack(piece.id); }
    else if   (ui.mode === 'reconning'  && piece && targetSet.has(piece.id)) { doRecon(piece.id); }
    else if   (ui.mode === 'placingMine')                                    { doPlaceMine({ r, c }); }
    else if   (ui.mode === 'liftingMine' && mineMap.has(`${r},${c}`))       { doLiftMine({ r, c }); }
  }

  const cells = useMemo(() => {
    const arr = [];
    for (let r = 1; r <= ROWS; r++)
      for (let c = 1; c <= COLS; c++)
        arr.push({ r, c });
    return arr;
  }, []);

  return (
    <BoardViewport cols={COLS} rows={ROWS}>
      {(cellSize, rot) => {
        const { dc, dr } = displayDims(rot, COLS, ROWS);
        const boardW = cellSize * dc;
        const boardH = cellSize * dr;
        const foldSide = mapSide(rot, 'right');
        const stripeA = mapSide(rot, 'top');
        const stripeB = mapSide(rot, 'bottom');
        const foldVertical = rot === 0 || rot === 180;

        return (
          <div style={{
            position: 'absolute', inset: 0,
            border: `1px solid rgba(0,255,80,0.25)`,
            boxShadow: `0 0 0 1px rgba(0,255,80,0.1), 0 0 40px rgba(0,255,80,0.08), inset 0 0 60px rgba(0,10,2,0.6)`,
            cursor: locked ? 'wait' : undefined,
          }}>
            <RadarCanvas width={boardW} height={boardH} />

            {cellSize >= 24 && Array.from({ length: COLS }, (_, i) => {
              const { row, col } = mapCell(rot, 1, i + 1, COLS, ROWS);
              return (
                <div key={`c${i}`} style={columnLabelStyle(rot, cellSize, dc, dr, row, col)}>{i + 1}</div>
              );
            })}

            <ZoneLabels cellSize={cellSize} rot={rot} />

            <div style={{
              position: 'absolute', inset: 0,
              display: 'grid',
              gridTemplateColumns: `repeat(${dc}, ${cellSize}px)`,
              gridTemplateRows: `repeat(${dr}, ${cellSize}px)`,
              zIndex: 1,
            }}>
              {cells.map(({ r, c }) => {
                const key = `${r},${c}`;
                const kind = getCellKind(r, c);
                const piece = pieceMap.get(key);
                const mine  = mineMap.get(key);
                const isHL  = highlightSet.has(key);
                const isTargetCell = piece ? targetSet.has(piece.id) : false;
                const { row, col } = mapCell(rot, r, c, COLS, ROWS);

                const bg  = cellBg(kind, isHL, isTargetCell && !piece);
                const bdr = cellBorder(kind, isHL, isTargetCell && !piece);
                const border: Record<string, string> = {
                  borderRight: `1px solid ${bdr}`,
                  borderBottom: `1px solid ${bdr}`,
                };
                if (c === 12) border[sideBorder(foldSide)] = '1px solid rgba(0,255,80,0.2)';

                return (
                  <div
                    key={key}
                    onClick={() => handleCellClick(r, c)}
                    style={{
                      gridRow: row, gridColumn: col,
                      width: cellSize, height: cellSize,
                      position: 'relative',
                      backgroundColor: bg,
                      boxSizing: 'border-box',
                      ...border,
                      cursor: 'crosshair',
                    }}
                  >
                    {kind === 'island' && (
                      <div style={{
                        position: 'absolute', inset: 0,
                        background: 'repeating-linear-gradient(45deg, rgba(0,100,20,0.3) 0,rgba(0,100,20,0.3) 2px, transparent 2px, transparent 5px)',
                        pointerEvents: 'none',
                      }} />
                    )}

                    {kind === 'workshop' && cellSize > 22 && (
                      <div style={{
                        position: 'absolute', bottom: 1, left: 2,
                        fontSize: 7, color: 'rgba(0,255,80,0.7)',
                        pointerEvents: 'none', lineHeight: 1,
                      }}>⚙</div>
                    )}

                    {kind === 'arrivalA' && <div style={stripeStyle(stripeA, 'rgba(0,255,80,0.4)')} />}
                    {kind === 'arrivalB' && <div style={stripeStyle(stripeB, 'rgba(255,120,0,0.4)')} />}

                    {mine && !piece && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <IconMine
                          size={Math.floor(cellSize * 0.5)}
                          color={mine === 'A' ? '#00ff66' : '#ffaa00'}
                        />
                      </div>
                    )}

                    {isHL && !piece && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{
                          width: cellSize * 0.25, height: cellSize * 0.25, borderRadius: '50%',
                          background: '#00ff66',
                          boxShadow: '0 0 8px #00ff66, 0 0 16px #00ff66',
                          animation: 'phosphor-pulse 1s infinite',
                        }} />
                      </div>
                    )}

                    {isTargetCell && !piece && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{
                          width: cellSize * 0.5, height: cellSize * 0.5,
                          border: '1px solid rgba(255,50,0,0.8)',
                          borderRadius: '50%',
                          boxShadow: '0 0 6px rgba(255,50,0,0.6)',
                        }} />
                      </div>
                    )}

                    {piece && (
                      <div style={{ position: 'absolute', inset: 2 }}>
                        <PieceToken
                          piece={piece} viewAs={viewAs}
                          selected={piece.id === ui.selectedPieceId}
                          targetable={targetSet.has(piece.id)}
                          cellSize={cellSize - 4}
                          onClick={() => handleCellClick(r, c)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {cellSize >= 24 && (
              <div style={{
                position: 'absolute',
                ...(foldVertical
                  ? { left: 12 * cellSize - 1, top: 0, bottom: 0, width: 1 }
                  : { top: 12 * cellSize - 1, left: 0, right: 0, height: 1 }),
                background: 'rgba(0,255,80,0.15)',
                pointerEvents: 'none',
                zIndex: 3,
              }} />
            )}
          </div>
        );
      }}
    </BoardViewport>
  );
};

const ZoneLabels: React.FC<{ cellSize: number; rot: Rot }> = ({ cellSize, rot }) => {
  if (cellSize < 28) return null;
  const label = (r1: number, r2: number, text: string, color: string) => {
    const rect = mapRect(rot, r1, 1, r2, COLS, COLS, ROWS);
    return (
      <div style={{
        position: 'absolute',
        left: rect.left * cellSize, top: rect.top * cellSize,
        width: rect.width * cellSize, height: rect.height * cellSize,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none', zIndex: 2,
      }}>
        <span style={{ fontSize: 9, letterSpacing: 4, color, textTransform: 'uppercase', textShadow: `0 0 8px ${color}` }}>
          ◀ {text} ▶
        </span>
      </div>
    );
  };
  return (
    <>
      {label(1, 7, 'ZONA J.A', 'rgba(0,255,80,0.3)')}
      {label(14, 20, 'ZONA J.B', 'rgba(255,150,0,0.3)')}
    </>
  );
};
