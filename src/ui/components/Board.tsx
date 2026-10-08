import React, { useMemo, useRef } from 'react';
import type { Player } from '../../engine/types';
import { getCellKind } from '../../engine/board';
import { useGameStore, canSeeIdentity } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { getReachableCells } from '../../engine/movement';
import { getTargetableCells } from '../../engine/lineOfSight';
import { getActualRange, getNominalRange } from '../../engine/pieces';
import { PieceToken } from './PieceToken';
import { RadarCanvas } from './RadarCanvas';
import { BoardViewport } from './BoardViewport';
import { IconMine } from './PieceIcons';
import { boardConfig } from '../../config/boardConfig';
import { mix } from '../ui';
import { useSideTones } from '../theme';
import { displayDims, mapCell, mapRect, mapSide, sideBorder, type Rot, type Side } from '../boardRotation';

const COLS = boardConfig.cols;
const ROWS = boardConfig.rows;

function cellBg(kind: string, highlighted: boolean, targetable: boolean): string {
  if (highlighted)  return mix('var(--main)', 20);
  if (targetable)   return mix('var(--danger)', 20);
  switch (kind) {
    case 'island':   return mix('var(--main)', 14);
    case 'workshop': return mix('var(--main)', 22);
    case 'bay':      return mix('var(--main)', 10);
    case 'arrivalA': return mix('var(--main)', 9);
    case 'arrivalB': return mix('var(--rv)', 9);
    default:         return 'transparent';
  }
}

function cellBorder(kind: string, highlighted: boolean, targetable: boolean): string {
  if (highlighted) return mix('var(--main)', 55);
  if (targetable)  return mix('var(--danger)', 55);
  switch (kind) {
    case 'island':   return mix('var(--main)', 30);
    case 'workshop': return mix('var(--main)', 40);
    case 'bay':      return mix('var(--main)', 20);
    case 'arrivalA': return mix('var(--main)', 25);
    case 'arrivalB': return mix('var(--rv)', 30);
    default:         return mix('var(--main)', 9);
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
    position: 'absolute', fontSize: 9, color: mix('var(--main)', 45),
    pointerEvents: 'none', letterSpacing: 0, zIndex: 2, lineHeight: 1,
  };
  if (side === 'top')    return { ...common, left: (col - 1) * cellSize + 2, top: 1 };
  if (side === 'bottom') return { ...common, left: (col - 1) * cellSize + 2, top: dr * cellSize - 11 };
  if (side === 'left')   return { ...common, left: 2, top: (row - 1) * cellSize + 1 };
  return { ...common, left: dc * cellSize - 12, top: (row - 1) * cellSize + 1 };
}

interface Props { viewAs: Player; locked?: boolean }

export const Board: React.FC<Props> = ({ viewAs, locked }) => {
  const { game, ui, selectPiece, inspect, openPieceZoom, doMove, doAttack, doRecon, doPlaceMine, doLiftMine } = useGameStore();
  const tones = useSideTones();
  const showRanges = useSettings(s => s.showRanges);
  const pieceZoomOn = useSettings(s => s.pieceZoomOn);
  const lastClick = useRef<{ id: string; t: number } | null>(null);

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

  const ranges = useMemo(() => {
    const empty = { move: new Set<string>(), fire: new Set<string>() };
    if (!showRanges || !ui.inspectId) return empty;
    const piece = game.pieces.find(p => p.id === ui.inspectId);
    if (!piece || !piece.pos || !canSeeIdentity(piece, viewAs)) return empty;

    const ownerTokens = game.numberTokens[piece.owner];
    const budget = piece.owner === game.turn && game.selectedNumberToken !== null
      ? game.selectedNumberToken - game.movementBudgetSpent
      : ownerTokens.length ? Math.max(...ownerTokens) : 0;
    const move = new Set(getReachableCells(piece, budget, game.pieces, game.mines).map(c => `${c.r},${c.c}`));

    const range = game.options.advancedActualRange ? getActualRange(piece) : getNominalRange(piece.type);
    const fire = new Set(getTargetableCells(piece.pos.r, piece.pos.c, range, game.pieces, game.mines).map(c => `${c.r},${c.c}`));
    return { move, fire };
  }, [showRanges, ui.inspectId, game.pieces, game.mines, game.turn, game.selectedNumberToken, game.movementBudgetSpent, game.numberTokens, game.options.advancedActualRange, viewAs]);

  function handleCellClick(r: number, c: number) {
    const piece = pieceMap.get(`${r},${c}`);

    if (piece && pieceZoomOn) {
      const now = performance.now();
      const last = lastClick.current;
      if (last && last.id === piece.id && now - last.t < 350) {
        lastClick.current = null;
        openPieceZoom(piece.id);
        return;
      }
      lastClick.current = { id: piece.id, t: now };
    } else {
      lastClick.current = null;
    }

    if (locked) {
      inspect(piece ? piece.id : null);
      return;
    }

    if (ui.mode === 'moving' || ui.mode === 'idle') {
      if (piece?.owner === game.turn) { selectPiece(piece.id); return; }
      if (ui.selectedPieceId && highlightSet.has(`${r},${c}`)) { doMove({ r, c }); return; }
      if (piece) { inspect(piece.id); return; }
      selectPiece(null);
    } else if (ui.mode === 'attacking') {
      if (piece && targetSet.has(piece.id)) doAttack(piece.id);
      else if (piece) inspect(piece.id);
    } else if (ui.mode === 'reconning') {
      if (piece && targetSet.has(piece.id)) doRecon(piece.id);
      else if (piece) inspect(piece.id);
    }
    else if (ui.mode === 'placingMine')                                { doPlaceMine({ r, c }); }
    else if (ui.mode === 'liftingMine' && mineMap.has(`${r},${c}`))   { doLiftMine({ r, c }); }
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
            border: `1px solid ${mix('var(--main)', 35)}`,
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
                const inFire = ranges.fire.has(key);
                const potentialMove = !isHL && ranges.move.has(key);
                const isTargetCell = piece ? targetSet.has(piece.id) : false;
                const { row, col } = mapCell(rot, r, c, COLS, ROWS);

                const bg  = cellBg(kind, isHL, isTargetCell && !piece);
                const bdr = cellBorder(kind, isHL, isTargetCell && !piece);
                const border: Record<string, string> = {
                  borderRight: `1px solid ${bdr}`,
                  borderBottom: `1px solid ${bdr}`,
                };
                if (c === 12) border[sideBorder(foldSide)] = `1px solid ${mix('var(--main)', 35)}`;

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
                        background: `repeating-linear-gradient(45deg, ${mix('var(--main)', 22)} 0, ${mix('var(--main)', 22)} 2px, transparent 2px, transparent 6px)`,
                        pointerEvents: 'none',
                      }} />
                    )}

                    {kind === 'workshop' && cellSize > 22 && (
                      <div style={{
                        position: 'absolute', bottom: 1, left: 2,
                        fontSize: 9, color: mix('var(--main)', 80),
                        pointerEvents: 'none', lineHeight: 1,
                      }}>⚙</div>
                    )}

                    {kind === 'arrivalA' && <div style={stripeStyle(stripeA, mix('var(--main)', 65))} />}
                    {kind === 'arrivalB' && <div style={stripeStyle(stripeB, mix('var(--rv)', 65))} />}

                    {mine && !piece && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <IconMine
                          size={Math.floor(cellSize * 0.5)}
                          color={mine === 'A' ? tones.A.main : tones.B.main}
                        />
                      </div>
                    )}

                    {inFire && (
                      <div style={{
                        position: 'absolute', inset: 0, pointerEvents: 'none',
                        background: mix('var(--danger)', 11),
                        boxShadow: `inset 0 0 0 1px ${mix('var(--danger)', 32)}`,
                      }} />
                    )}

                    {potentialMove && !piece && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{
                          width: cellSize * 0.2, height: cellSize * 0.2, borderRadius: '50%',
                          background: mix('var(--main)', 55),
                        }} />
                      </div>
                    )}

                    {isHL && !piece && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{
                          width: cellSize * 0.25, height: cellSize * 0.25, borderRadius: '50%',
                          background: 'var(--main)',
                          animation: 'pulse 1.2s infinite',
                        }} />
                      </div>
                    )}

                    {isTargetCell && !piece && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{
                          width: cellSize * 0.5, height: cellSize * 0.5,
                          border: '2px solid var(--danger)',
                          borderRadius: '50%',
                        }} />
                      </div>
                    )}

                    {piece && (
                      <div style={{ position: 'absolute', inset: 2 }}>
                        <PieceToken
                          piece={piece} viewAs={viewAs}
                          selected={piece.id === ui.selectedPieceId || piece.id === ui.inspectId}
                          enlarge={pieceZoomOn}
                          targetable={targetSet.has(piece.id)}
                          cellSize={cellSize - 4}
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
                background: mix('var(--main)', 30),
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
        <span style={{ fontSize: 11, letterSpacing: 3, color, textTransform: 'uppercase', fontWeight: 700 }}>
          {text}
        </span>
      </div>
    );
  };
  return (
    <>
      {label(1, 7, 'ZONA J.A', mix('var(--main)', 30))}
      {label(14, 20, 'ZONA J.B', mix('var(--rv)', 30))}
    </>
  );
};
