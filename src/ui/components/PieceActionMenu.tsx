import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Piece } from '../../engine/types';
import { useGameStore } from '../../store/gameStore';
import { PIECE_NAMES } from '../messages';
import { getPieceActions, modeHint, type ActionMode } from '../pieceActions';
import { mix } from '../ui';

export interface DisplayRect { left: number; top: number; width: number; height: number }

interface Props {
  piece: Piece;
  /** Celda de la ficha en coordenadas de pantalla del tablero (px). */
  anchor: DisplayRect;
  boardW: number;
  boardH: number;
  /** Rectángulos que conviene no tapar (casillas alcanzables, blancos). */
  avoid: DisplayRect[];
}

const GAP = 8;
const EDGE = 2;
const MENU_W = 214;
const MIN_W = 150;

type Side = 'right' | 'left' | 'below' | 'above';
interface Placed { left: number; top: number; side: Side }

const overlap = (a: DisplayRect, b: DisplayRect) =>
  a.left < b.left + b.width && a.left + a.width > b.left &&
  a.top < b.top + b.height && a.top + a.height > b.top;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * Elige de qué lado de la ficha abrir el menú dentro de `bounds` (el área
 * visible del tablero): el lado que entra y tapa menos casillas importantes.
 */
export function placeMenu(
  anchor: DisplayRect, w: number, h: number, bounds: DisplayRect, avoid: DisplayRect[],
): Placed {
  const minX = bounds.left + EDGE;
  const maxX = bounds.left + bounds.width - w - EDGE;
  const minY = bounds.top + EDGE;
  const maxY = bounds.top + bounds.height - h - EDGE;
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  const candidates: Placed[] = [
    { side: 'right', left: anchor.left + anchor.width + GAP, top: clamp(cy - h / 2, minY, maxY) },
    { side: 'left', left: anchor.left - GAP - w, top: clamp(cy - h / 2, minY, maxY) },
    { side: 'below', left: clamp(cx - w / 2, minX, maxX), top: anchor.top + anchor.height + GAP },
    { side: 'above', left: clamp(cx - w / 2, minX, maxX), top: anchor.top - GAP - h },
  ];
  const fits = (p: Placed) =>
    p.left >= bounds.left && p.top >= bounds.top &&
    p.left + w <= bounds.left + bounds.width && p.top + h <= bounds.top + bounds.height;

  let best: Placed | null = null;
  let bestScore = Infinity;
  for (const p of candidates) {
    if (!fits(p)) continue;
    const rect = { left: p.left, top: p.top, width: w, height: h };
    const score = avoid.reduce((n, r) => n + (overlap(rect, r) ? 1 : 0), 0);
    if (score < bestScore) { best = p; bestScore = score; }
  }
  if (best) return best;

  // Área demasiado chica para cualquier lado: el primero, recortado a los bordes.
  const fallback = candidates[0];
  return { side: fallback.side, left: clamp(fallback.left, minX, maxX), top: clamp(fallback.top, minY, maxY) };
}

/** Parte del tablero que se ve en pantalla (el tablero puede estar ampliado y desplazado). */
function visibleBounds(el: HTMLElement, boardW: number, boardH: number): DisplayRect {
  const full = { left: 0, top: 0, width: boardW, height: boardH };
  const boardEl = el.offsetParent as HTMLElement | null;
  const scroller = el.closest('[data-board-scroller]') as HTMLElement | null;
  if (!boardEl || !scroller) return full;
  const b = boardEl.getBoundingClientRect();
  const s = scroller.getBoundingClientRect();
  const left = Math.max(0, s.left - b.left);
  const top = Math.max(0, s.top - b.top);
  const right = Math.min(boardW, s.right - b.left);
  const bottom = Math.min(boardH, s.bottom - b.top);
  if (right - left < 60 || bottom - top < 60) return full;
  return { left, top, width: right - left, height: bottom - top };
}

const sameBounds = (a: DisplayRect, b: DisplayRect) =>
  Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

export const PieceActionMenu: React.FC<Props> = ({ piece, anchor, boardW, boardH, avoid }) => {
  const game = useGameStore(s => s.game);
  const ui = useGameStore(s => s.ui);
  const selectToken = useGameStore(s => s.selectToken);
  const selectPiece = useGameStore(s => s.selectPiece);
  const setMode = useGameStore(s => s.setMode);

  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [bounds, setBounds] = useState<DisplayRect>({ left: 0, top: 0, width: boardW, height: boardH });
  /** Posición elegida a mano (arrastrando el título): el menú se queda ahí aunque la ficha se mueva. */
  const [manual, setManual] = useState<{ left: number; top: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const tokenChosen = game.selectedNumberToken !== null;
  const actions = useMemo(() => getPieceActions(game, piece), [game, piece]);
  const activeMode: ActionMode = ui.mode === 'idle' ? 'moving' : ui.mode;
  const activeAction = actions.find(a => a.mode === activeMode);
  const hint = tokenChosen
    ? modeHint(activeMode, { reachable: ui.highlightedCells.length, targets: ui.targetablePieceIds.length })
    : null;
  const detail = tokenChosen && activeMode !== 'moving' && activeAction ? activeAction.detail : null;

  // Un aviso de "no se puede" dura unos segundos.
  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 3500);
    return () => window.clearTimeout(t);
  }, [note]);

  // Ancho: el de siempre, o el que sobra al costado de la ficha si es menor.
  const maxW = Math.max(120, Math.min(MENU_W, bounds.width - EDGE * 2));
  const roomRight = bounds.left + bounds.width - (anchor.left + anchor.width) - GAP - EDGE;
  const roomLeft = anchor.left - GAP - EDGE - bounds.left;
  const room = Math.max(roomRight, roomLeft);
  const width = room >= MIN_W ? Math.min(maxW, room) : maxW;

  const avoidKey = avoid.map(r => `${r.left},${r.top}`).join('|');

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const vis = visibleBounds(el, boardW, boardH);
    setBounds(prev => (sameBounds(prev, vis) ? prev : vis));
    const next = placeMenu(anchor, el.offsetWidth, el.offsetHeight, vis, avoid);
    setPlaced(prev => (prev && prev.left === next.left && prev.top === next.top && prev.side === next.side ? prev : next));
  };

  useLayoutEffect(measure, [
    anchor.left, anchor.top, anchor.width, boardW, boardH, avoidKey,
    tokenChosen, activeMode, hint, detail, note, width, bounds.left, bounds.top, bounds.width, bounds.height,
  ]);

  // Re-medir si cambia el tamaño del menú, se desplaza el tablero ampliado o cambia la ventana.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    obs?.observe(el);
    const scroller = el.closest('[data-board-scroller]');
    scroller?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      obs?.disconnect();
      scroller?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  });

  // Escape cierra el menú (si el popup grande está abierto, es él quien lo atiende).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useGameStore.getState().ui.zoomPieceId) selectPiece(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectPiece]);

  const pickToken = (t: number) => {
    const id = piece.id;
    selectToken(t);
    if (useGameStore.getState().game.selectedNumberToken === t) selectPiece(id);
  };

  const menuW = ref.current?.offsetWidth ?? width;
  const menuH = ref.current?.offsetHeight ?? 0;
  const pos: Placed | null = manual
    ? {
        side: 'right',
        left: clamp(manual.left, bounds.left + EDGE, bounds.left + bounds.width - menuW - EDGE),
        top: clamp(manual.top, bounds.top + EDGE, bounds.top + bounds.height - menuH - EDGE),
      }
    : placed;

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || !pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top };
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setManual({ left: d.left + e.clientX - d.x, top: d.top + e.clientY - d.y });
  };
  const onDragEnd = () => { drag.current = null; };

  const accent = 'var(--main)';
  const arrowSize = 10;
  const cy = anchor.top + anchor.height / 2;
  const cx = anchor.left + anchor.width / 2;
  const arrow: React.CSSProperties | null = pos && !manual ? (() => {
    const base: React.CSSProperties = {
      position: 'absolute', width: arrowSize, height: arrowSize, background: 'var(--bg)',
      transform: 'rotate(45deg)', pointerEvents: 'none',
    };
    const edge = `1px solid ${mix(accent, 55)}`;
    if (pos.side === 'right') return { ...base, left: -arrowSize / 2, top: clamp(cy - pos.top - arrowSize / 2, 8, menuH - 18), borderLeft: edge, borderBottom: edge };
    if (pos.side === 'left') return { ...base, right: -arrowSize / 2, top: clamp(cy - pos.top - arrowSize / 2, 8, menuH - 18), borderRight: edge, borderTop: edge };
    if (pos.side === 'below') return { ...base, top: -arrowSize / 2, left: clamp(cx - pos.left - arrowSize / 2, 8, menuW - 18), borderLeft: edge, borderTop: edge };
    return { ...base, bottom: -arrowSize / 2, left: clamp(cx - pos.left - arrowSize / 2, 8, menuW - 18), borderRight: edge, borderBottom: edge };
  })() : null;

  const closeBtn: React.CSSProperties = {
    width: 24, height: 24, flexShrink: 0, borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--line)', background: 'transparent', color: 'var(--main-soft)',
    fontSize: 13, lineHeight: 1, padding: 0,
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Acciones de ${PIECE_NAMES[piece.type]}`}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      style={{
        position: 'absolute', zIndex: 8,
        left: pos?.left ?? 0, top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        width,
        boxSizing: 'border-box',
        animation: 'popin 0.12s ease-out',
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {arrow && <div style={arrow} />}
      <div style={{
        position: 'relative',
        maxHeight: Math.max(100, bounds.height - EDGE * 2),
        overflowY: 'auto',
        boxSizing: 'border-box',
        background: 'var(--bg)',
        backgroundImage: `linear-gradient(${mix(accent, 9)}, ${mix(accent, 9)})`,
        border: `1px solid ${mix(accent, 55)}`,
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
        padding: '6px 8px 8px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onDoubleClick={e => { e.stopPropagation(); setManual(null); }}
          title="Arrastrá para correr el menú; doble toque para volver junto a la ficha"
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'grab', touchAction: 'none' }}
        >
          <span aria-hidden style={{ color: 'var(--main-mute)', fontSize: 13, letterSpacing: -2, lineHeight: 1 }}>⋮⋮</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: accent, lineHeight: 1.2 }}>
              {PIECE_NAMES[piece.type]}
              <span style={{ fontWeight: 600, fontSize: 10.5, color: piece.damaged ? 'var(--warn)' : 'var(--main-mute)' }}>
                {piece.damaged ? ' · averiado' : ''}{tokenChosen ? ` · ficha ${game.selectedNumberToken}` : ''}
              </span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar menú de la ficha"
            title="Cerrar"
            onClick={() => selectPiece(null)}
            style={closeBtn}
          >×</button>
        </div>

        {!tokenChosen ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--main-soft)', lineHeight: 1.35 }}>
              Elegí una ficha de movimiento para jugar este turno:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {game.numberTokens[game.turn].map((t, i) => (
                <button
                  key={`${t}-${i}`}
                  type="button"
                  className="menu-btn"
                  onClick={() => pickToken(t)}
                  style={{
                    minWidth: 34, height: 34, borderRadius: 4, cursor: 'pointer',
                    border: `1px solid ${mix(accent, 60)}`, background: mix(accent, 10),
                    color: accent, fontSize: 15, fontWeight: 800,
                  }}
                >{t}</button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {actions.map(a => {
                const active = a.enabled && activeMode === a.mode;
                return (
                  <button
                    key={a.mode}
                    type="button"
                    className="menu-btn"
                    aria-disabled={!a.enabled}
                    title={a.detail}
                    onClick={() => (a.enabled ? setMode(a.mode) : setNote(`${a.label}: ${a.detail}.`))}
                    style={{
                      padding: '0 10px', height: 30, borderRadius: 5, fontSize: 12.5, fontWeight: 700,
                      cursor: a.enabled ? 'pointer' : 'not-allowed',
                      border: `1px solid ${active ? accent : mix(accent, 35)}`,
                      background: active ? mix(accent, 26) : 'transparent',
                      color: a.enabled ? accent : 'var(--main-mute)',
                      opacity: a.enabled ? 1 : 0.5,
                      boxShadow: active ? `0 0 0 1px ${mix(accent, 40)}` : 'none',
                    }}
                  >{a.label}</button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.4, color: note ? 'var(--warn)' : 'var(--text)' }}>
              {note ?? (
                <>
                  {detail && <span style={{ color: 'var(--main-soft)' }}>{detail} · </span>}
                  {hint}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
