import type { GameState, Piece } from '../engine/types';
import { getActualRange, getNominalRange } from '../engine/pieces';

export type ActionMode = 'moving' | 'attacking' | 'reconning' | 'placingMine' | 'liftingMine';

export interface PieceAction {
  mode: ActionMode;
  label: string;
  /** Texto corto bajo la etiqueta: dato útil o motivo por el que no se puede. */
  detail: string;
  enabled: boolean;
}

export const MAX_MINES = 15;

/** Alcance de tiro vigente de una pieza, en texto. */
export function rangeText(piece: Piece, advancedActualRange: boolean): string {
  const range = advancedActualRange ? getActualRange(piece) : getNominalRange(piece.type);
  if (range === Infinity) return 'sin límite';
  return range === 1 ? '1 casilla' : `${range} casillas`;
}

/**
 * Acciones que ofrece una pieza propia en este momento, según su tipo y el
 * estado del turno. Refleja las reglas del motor:
 *  - todas las piezas pueden moverse;
 *  - atacan todas menos el Avión de reconocimiento (el Avión de combate solo
 *    antes de moverse y una vez por turno);
 *  - reconoce solo el Avión de reconocimiento;
 *  - colocan y levantan minas solo los Minadores.
 */
export function getPieceActions(game: GameState, piece: Piece): PieceAction[] {
  const actions: PieceAction[] = [];
  const hasToken = game.selectedNumberToken !== null;
  const budget = hasToken ? game.selectedNumberToken! - game.movementBudgetSpent : 0;
  const stepCost = piece.damaged ? 2 : 1;
  const usedAction = game.attackOrReconUsedThisTurn;

  // Mover
  {
    const enabled = hasToken && budget >= stepCost;
    let detail: string;
    if (!hasToken) detail = 'elegí una ficha primero';
    else if (budget <= 0) detail = 'sin movimiento restante';
    else if (budget < stepCost) detail = 'averiado: cada casilla cuesta 2';
    else detail = `${budget} de movimiento${piece.damaged ? ' (averiado: 2 por casilla)' : ''}`;
    actions.push({ mode: 'moving', label: 'Mover', detail, enabled });
  }

  // Atacar (todas menos el Avión de reconocimiento)
  if (piece.type !== 'AvionReconocimiento') {
    let enabled = hasToken && !usedAction;
    let detail = `alcance: ${rangeText(piece, game.options.advancedActualRange)}`;
    if (!hasToken) detail = 'elegí una ficha primero';
    else if (usedAction) { detail = 'ya atacaste o reconociste'; }
    else if (piece.type === 'AvionCombate') {
      if (game.combatPlaneAttackUsedThisTurn) { enabled = false; detail = 'este avión ya atacó'; }
      else if (game.movementBudgetSpent > 0) { enabled = false; detail = 'solo antes de moverse'; }
      else detail = 'alcance: sin límite · antes de moverse';
    }
    actions.push({ mode: 'attacking', label: 'Atacar', detail, enabled });
  }

  // Reconocer (solo Avión de reconocimiento)
  if (piece.type === 'AvionReconocimiento') {
    const enabled = hasToken && !usedAction;
    const detail = !hasToken
      ? 'elegí una ficha primero'
      : usedAction ? 'ya atacaste o reconociste' : 'revela una pieza rival en línea';
    actions.push({ mode: 'reconning', label: 'Reconocer', detail, enabled });
  }

  // Minas (solo Minador)
  if (piece.type === 'Minador') {
    const placed = game.mines.filter(m => m.owner === game.turn).length;
    const left = MAX_MINES - placed;
    actions.push({
      mode: 'placingMine',
      label: 'Colocar mina',
      detail: left > 1 ? `te quedan ${left}` : left === 1 ? 'te queda 1' : 'no te quedan minas',
      enabled: left > 0,
    });
    actions.push({
      mode: 'liftingMine',
      label: 'Levantar mina',
      detail: game.mines.length > 0 ? 'retirá una mina del tablero' : 'no hay minas en el tablero',
      enabled: game.mines.length > 0,
    });
  }

  return actions;
}

/** Indicación contextual que se muestra mientras un modo está activo. */
export function modeHint(mode: ActionMode, opts: { reachable: number; targets: number }): string {
  switch (mode) {
    case 'moving':
      return opts.reachable > 0
        ? 'Tocá una casilla marcada para mover.'
        : 'No hay casillas alcanzables con el movimiento que queda.';
    case 'attacking':
      return opts.targets > 0
        ? 'Tocá un rival marcado en rojo para atacar.'
        : 'No hay rivales a tiro: deben estar en línea recta, dentro del alcance y con visión libre.';
    case 'reconning':
      return opts.targets > 0
        ? 'Tocá un rival marcado en rojo para reconocerlo.'
        : 'No hay rivales a la vista en línea recta.';
    case 'placingMine':
      return 'Tocá la casilla donde colocar la mina.';
    case 'liftingMine':
      return 'Tocá una mina del tablero para levantarla.';
  }
}
