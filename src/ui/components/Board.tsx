import React, { useMemo, useRef, useLayoutEffect, useState } from 'react';
import type { Player } from '../../engine/types';
import { getCellKind } from '../../engine/board';
import { useGameStore } from '../../store/gameStore';
import { PieceToken } from './PieceToken';
import { RadarCanvas } from './RadarCanvas';
import { IconMine } from './PieceIcons';
import { boardConfig } from '../../config/boardConfig';

const COLS = boardConfig.cols;
const ROWS = boardConfig.rows;

const P = '#00ff66';

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

interface Props { viewAs: Player }

export const Board: React.FC<Props> = ({ viewAs }) => {
  const { game, ui, selectPiece, doMove, doAttack, doRecon, doPlaceMine, doLiftMine } = useGameStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [cellSize, setCellSize] = useState(40);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const byW = Math.floor(width / COLS);
      const byH = Math.floor(height / ROWS);
      setCellSize(Math.max(18, Math.min(byW, byH, 60)));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const boardW = cellSize * COLS;
  const boardH = cellSize * ROWS;

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
    <div
      ref={containerRef}
      style={{
        flex: 1, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        minWidth: 0, minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'relative',
        width: boardW, height: boardH,
        flexShrink: 0,
        border: `1px solid rgba(0,255,80,0.25)`,
        boxShadow: `0 0 0 1px rgba(0,255,80,0.1), 0 0 40px rgba(0,255,80,0.08), inset 0 0 60px rgba(0,10,2,0.6)`,
      }}>
        {/* Animated radar background */}
        <RadarCanvas width={boardW} height={boardH} />

        {/* Coordinate labels */}
        {cellSize >= 24 && Array.from({ length: COLS }, (_, i) => (
          <div key={`c${i}`} style={{
            position: 'absolute',
            left: i * cellSize, top: -14, width: cellSize,
            textAlign: 'center', fontSize: 7,
            color: 'rgba(0,255,80,0.25)', pointerEvents: 'none',
            letterSpacing: 0,
          }}>{i + 1}</div>
        ))}

        {/* Zone strip labels */}
        <ZoneLabels cellSize={cellSize} />

        {/* Grid */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${COLS}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${ROWS}, ${cellSize}px)`,
          zIndex: 1,
        }}>
          {cells.map(({ r, c }) => {
            const key = `${r},${c}`;
            const kind = getCellKind(r, c);
            const piece = pieceMap.get(key);
            const mine  = mineMap.get(key);
            const isHL  = highlightSet.has(key);
            const isTargetCell = piece ? targetSet.has(piece.id) : false;
            const isFold = c === 12;

            const bg  = cellBg(kind, isHL, isTargetCell && !piece);
            const bdr = cellBorder(kind, isHL, isTargetCell && !piece);

            return (
              <div
                key={key}
                onClick={() => handleCellClick(r, c)}
                style={{
                  width: cellSize, height: cellSize,
                  position: 'relative',
                  backgroundColor: bg,
                  boxSizing: 'border-box',
                  borderRight:  isFold ? `1px solid rgba(0,255,80,0.2)` : `1px solid ${bdr}`,
                  borderBottom: `1px solid ${bdr}`,
                  cursor: 'crosshair',
                }}
              >
                {/* Island pattern */}
                {kind === 'island' && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'repeating-linear-gradient(45deg, rgba(0,100,20,0.3) 0,rgba(0,100,20,0.3) 2px, transparent 2px, transparent 5px)',
                    pointerEvents: 'none',
                  }} />
                )}

                {/* Workshop marker */}
                {kind === 'workshop' && cellSize > 22 && (
                  <div style={{
                    position: 'absolute', bottom: 1, left: 2,
                    fontSize: 7, color: 'rgba(0,255,80,0.7)',
                    pointerEvents: 'none', lineHeight: 1,
                  }}>⚙</div>
                )}

                {/* Arrival zone border stripe */}
                {kind === 'arrivalA' && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                    background: 'rgba(0,255,80,0.4)', pointerEvents: 'none',
                  }} />
                )}
                {kind === 'arrivalB' && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
                    background: 'rgba(255,120,0,0.4)', pointerEvents: 'none',
                  }} />
                )}

                {/* Mine */}
                {mine && !piece && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconMine
                      size={Math.floor(cellSize * 0.5)}
                      color={mine === 'A' ? '#00ff66' : '#ffaa00'}
                    />
                  </div>
                )}

                {/* Highlight dot (empty cell) */}
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

                {/* Target reticle (empty targetable cell) */}
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

                {/* Piece */}
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

        {/* Fold line label */}
        {cellSize >= 24 && (
          <div style={{
            position: 'absolute',
            left: 12 * cellSize - 1, top: 0, bottom: 0,
            width: 1,
            background: 'rgba(0,255,80,0.15)',
            pointerEvents: 'none',
            zIndex: 3,
          }} />
        )}
      </div>
    </div>
  );
};

const ZoneLabels: React.FC<{ cellSize: number }> = ({ cellSize }) => {
  if (cellSize < 28) return null;
  const label = (top: number, text: string, color: string) => (
    <div style={{
      position: 'absolute', top, left: 0, right: 0, height: cellSize * 7,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 2,
    }}>
      <span style={{ fontSize: 9, letterSpacing: 4, color, textTransform: 'uppercase', textShadow: `0 0 8px ${color}` }}>
        ◀ {text} ▶
      </span>
    </div>
  );
  return (
    <>
      {label(0, 'ZONA J.A', 'rgba(0,255,80,0.3)')}
      {label(cellSize * 13, 'ZONA J.B', 'rgba(255,150,0,0.3)')}
    </>
  );
};
