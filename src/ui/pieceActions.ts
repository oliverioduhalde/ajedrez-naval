import type { GameState, Piece } from '../engine/types';
import { getActualRange, getNominalRange } from '../engine/pieces';
import { getReachableCells } from '../engine/movement';
import { getTargetableCells } from '../engine/lineOfSight';

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
        ? 'Tocá una casilla marcada.'
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

export interface TurnStatus {
  canMove: boolean;
  canAttack: boolean;
  canRecon: boolean;
  /** Queda algo por hacer: mover, atacar o reconocer (las minas no cuentan: siempre se pueden poner). */
  canAct: boolean;
}

const NONE: TurnStatus = { canMove: false, canAttack: false, canRecon: false, canAct: false };

/**
 * ¿Qué le queda por hacer al jugador de turno? Sirve para avisar "Finalizar turno"
 * cuando ninguna pieza puede moverse, atacar ni reconocer.
 */
export function getTurnStatus(game: GameState): TurnStatus {
  if (game.phase !== 'play' || game.selectedNumberToken === null) return NONE;
  const budget = game.selectedNumberToken - game.movementBudgetSpent;
  const mine = game.pieces.filter(p => p.owner === game.turn && p.pos);
  const enemyCells = new Set(
    game.pieces.filter(p => p.owner !== game.turn && p.pos).map(p => `${p.pos!.r},${p.pos!.c}`),
  );
  const seesEnemy = (p: Piece, range: number) =>
    getTargetableCells(p.pos!.r, p.pos!.c, range, game.pieces, game.mines)
      .some(c => enemyCells.has(`${c.r},${c.c}`));

  // getReachableCells incluye la casilla de origen (se puede ir y volver): no cuenta como movimiento.
  const canMove = budget > 0 && mine.some(p =>
    getReachableCells(p, budget, game.pieces, game.mines)
      .some(c => c.r !== p.pos!.r || c.c !== p.pos!.c));

  const canAttack = !game.attackOrReconUsedThisTurn && mine.some(p => {
    if (p.type === 'AvionReconocimiento') return false;
    if (p.type === 'AvionCombate' && (game.movementBudgetSpent > 0 || game.combatPlaneAttackUsedThisTurn)) return false;
    const range = game.options.advancedActualRange ? getActualRange(p) : getNominalRange(p.type);
    return seesEnemy(p, range);
  });

  const canRecon = !game.attackOrReconUsedThisTurn && mine.some(p =>
    p.type === 'AvionReconocimiento' && seesEnemy(p, Infinity));

  return { canMove, canAttack, canRecon, canAct: canMove || canAttack || canRecon };
}
