/**
 * Pure game engine — all state transitions.
 * No side effects, no imports from React/UI.
 */
import type { GameState, Player, Piece } from './types';
import { createFleet, getNominalRange, getActualRange, pieceLabel } from './pieces';
import { resolveCombat, isFatalResult } from './combat';
import { hasLineOfSight } from './lineOfSight';
import { applyMove } from './movement';
import { initialTokens, transferToken, enforceOlvidos } from './tokens';
import { getCellKind, getSetupCells } from './board';

// ─── Initial state ───────────────────────────────────────────────────────────

export function createInitialState(options?: Partial<GameState['options']>): GameState {
  const opts: GameState['options'] = {
    useDice: false,
    advancedActualRange: false,
    randomIslands: false,
    presentation: { mode: 'passAndPlay', handoffPin: false },
    ...options,
  };

  return {
    pieces: [...createFleet('A'), ...createFleet('B')],
    mines: [],
    turn: 'A',
    numberTokens: initialTokens(),
    phase: 'setup',
    setupPlayer: 'A',
    combatPlaneAttackUsedThisTurn: false,
    attackOrReconUsedThisTurn: false,
    movementBudgetSpent: 0,
    selectedNumberToken: null,
    options: opts,
    log: [],
    winner: null,
    setupPlacedPieceIds: [],
  };
}

// ─── Visibility ──────────────────────────────────────────────────────────────

export function canSeeIdentity(piece: Piece, viewAs: Player): boolean {
  return (
    piece.owner === viewAs ||
    piece.revealedTo.includes(viewAs) ||
    piece.damaged
  );
}

// ─── Setup phase ─────────────────────────────────────────────────────────────

export function placePieceInSetup(
  state: GameState,
  pieceId: string,
  pos: { r: number; c: number },
): GameState | string {
  if (state.phase !== 'setup' && state.phase !== 'setupB') return 'Not in setup phase';

  const piece = state.pieces.find(p => p.id === pieceId);
  if (!piece) return 'Piece not found';
  if (piece.owner !== state.setupPlayer) return 'Not your piece';

  const validCells = getSetupCells(state.setupPlayer);
  const isValid = validCells.some(c => c.r === pos.r && c.c === pos.c);
  if (!isValid) return 'Invalid setup position';

  const occupied = state.pieces.find(p => p.pos?.r === pos.r && p.pos?.c === pos.c);
  if (occupied) return 'Cell already occupied';

  const newPieces = state.pieces.map(p => p.id === pieceId ? { ...p, pos } : p);
  const newPlaced = [...state.setupPlacedPieceIds, pieceId];

  return { ...state, pieces: newPieces, setupPlacedPieceIds: newPlaced };
}

export function unplacePieceInSetup(
  state: GameState,
  pieceId: string,
): GameState | string {
  if (state.phase !== 'setup' && state.phase !== 'setupB') return 'Not in setup phase';

  const piece = state.pieces.find(p => p.id === pieceId);
  if (!piece) return 'Piece not found';
  if (piece.owner !== state.setupPlayer) return 'Not your piece';

  return {
    ...state,
    pieces: state.pieces.map(p => p.id === pieceId ? { ...p, pos: null } : p),
    setupPlacedPieceIds: state.setupPlacedPieceIds.filter(id => id !== pieceId),
  };
}

export function finishSetup(state: GameState): GameState | string {
  const player = state.setupPlayer;
  const myPieces = state.pieces.filter(p => p.owner === player);
  if (myPieces.some(p => p.pos === null)) return 'All pieces must be placed';

  if (player === 'A') {
    // Move to setupB (Player B places)
    return {
      ...state,
      phase: 'setupB',
      setupPlayer: 'B',
      setupPlacedPieceIds: [],
    };
  }

  // Both placed — move to handoff before first play turn
  return {
    ...state,
    phase: 'handoffPlay',
    turn: 'A', // A goes first (or whoever won the "1" token draw)
    numberTokens: enforceOlvidos(state.numberTokens, 'A'),
    log: [...state.log, 'Setup completado. ¡Comienza el juego!'],
  };
}

// ─── Play phase: token selection ─────────────────────────────────────────────

export function selectNumberToken(state: GameState, token: number): GameState | string {
  if (state.phase !== 'play') return 'Not in play phase';
  if (!state.numberTokens[state.turn].includes(token)) return 'Token not available';
  if (state.selectedNumberToken !== null) return 'Token already selected';
  return { ...state, selectedNumberToken: token };
}

// ─── Play phase: movement ────────────────────────────────────────────────────

export function movePiece(
  state: GameState,
  pieceId: string,
  destination: { r: number; c: number },
): GameState | string {
  if (state.phase !== 'play') return 'Not in play phase';
  if (state.selectedNumberToken === null) return 'Select a number token first';

  const piece = state.pieces.find(p => p.id === pieceId);
  if (!piece) return 'Piece not found';
  if (piece.owner !== state.turn) return "Not your piece";
  if (!piece.pos) return 'Piece is destroyed';

  const budget = state.selectedNumberToken - state.movementBudgetSpent;
  const stepCost = piece.damaged ? 2 : 1;

  // Simple single-step move (UI can call repeatedly)
  const dr = Math.abs(destination.r - piece.pos.r);
  const dc = Math.abs(destination.c - piece.pos.c);
  if (!((dr === 1 && dc === 0) || (dr === 0 && dc === 1))) {
    return 'Must move one cell at a time (call movePiece per step)';
  }

  if (budget < stepCost) return 'Not enough movement budget';

  const result = applyMove(piece, destination, state);
  if (result.destroyed) {
    return {
      ...state,
      pieces: result.pieces,
      mines: result.mines,
      movementBudgetSpent: state.movementBudgetSpent + stepCost,
      log: [...state.log, `${pieceLabel(piece.type)} (${piece.owner}) destruido por mina en (${destination.r},${destination.c})`],
    };
  }

  const logEntries: string[] = [];
  if (result.repairedAt) {
    logEntries.push(`${pieceLabel(piece.type)} (${piece.owner}) reparado en taller (${destination.r},${destination.c})`);
  }

  // Check victory
  const arrivalKind = getCellKind(destination.r, destination.c);
  const isVictoryCell =
    (piece.owner === 'A' && arrivalKind === 'arrivalB') ||
    (piece.owner === 'B' && arrivalKind === 'arrivalA');

  if (isVictoryCell) {
    return {
      ...state,
      pieces: result.pieces,
      mines: result.mines,
      movementBudgetSpent: state.movementBudgetSpent + stepCost,
      phase: 'finished',
      winner: piece.owner,
      log: [...state.log, ...logEntries, `¡${piece.owner} GANA! ${pieceLabel(piece.type)} llega a la zona de llegada rival.`],
    };
  }

  return {
    ...state,
    pieces: result.pieces,
    mines: result.mines,
    movementBudgetSpent: state.movementBudgetSpent + stepCost,
    log: logEntries.length ? [...state.log, ...logEntries] : state.log,
  };
}

// ─── Play phase: attack ──────────────────────────────────────────────────────

export function attackPiece(
  state: GameState,
  attackerId: string,
  targetId: string,
): GameState | string {
  if (state.phase !== 'play') return 'Not in play phase';
  if (state.attackOrReconUsedThisTurn) return 'Already attacked or reconned this turn';

  const attacker = state.pieces.find(p => p.id === attackerId);
  const target = state.pieces.find(p => p.id === targetId);
  if (!attacker || !target) return 'Piece not found';
  if (attacker.owner !== state.turn) return "Not your piece";
  if (target.owner === state.turn) return "Can't attack your own piece";
  if (!attacker.pos || !target.pos) return 'Piece not on board';

  // AvionCombate must attack before any movement
  if (attacker.type === 'AvionCombate') {
    if (state.movementBudgetSpent > 0) return 'AvionCombate must attack before moving';
    if (state.combatPlaneAttackUsedThisTurn) return 'Combat plane already attacked this turn';
  }

  // AvionReconocimiento cannot attack
  if (attacker.type === 'AvionReconocimiento') return 'AvionReconocimiento cannot attack';

  // Check range
  const range = state.options.advancedActualRange
    ? getActualRange(attacker)
    : getNominalRange(attacker.type);

  const dr = Math.abs(target.pos.r - attacker.pos.r);
  const dc = Math.abs(target.pos.c - attacker.pos.c);

  // Must be orthogonal
  if (dr !== 0 && dc !== 0) return 'Attack must be in a straight orthogonal line';
  const dist = dr + dc;

  if (range !== Infinity && dist > range) return 'Target out of range';

  // Line of sight
  if (!hasLineOfSight(attacker.pos, target.pos, state.pieces)) {
    return 'Line of sight blocked';
  }

  // Reveal target to attacker
  const result = resolveCombat(attacker, target, dist, state.options.advancedActualRange);
  const opponent: Player = state.turn === 'A' ? 'B' : 'A';

  let newPieces = state.pieces.map(p => {
    if (p.id === target.id) {
      const revealed = p.revealedTo.includes(state.turn)
        ? p.revealedTo
        : [...p.revealedTo, state.turn];
      if (isFatalResult(result)) return { ...p, pos: null, revealedTo: revealed };
      if (result === 'AVERIADO') return { ...p, damaged: true, revealedTo: [state.turn, opponent] };
      return { ...p, revealedTo: revealed };
    }
    return p;
  });

  const logLine = `${pieceLabel(attacker.type)} (${state.turn}) ataca a ${pieceLabel(target.type)} (${opponent}) → ${result}`;

  return {
    ...state,
    pieces: newPieces,
    attackOrReconUsedThisTurn: true,
    combatPlaneAttackUsedThisTurn:
      attacker.type === 'AvionCombate' ? true : state.combatPlaneAttackUsedThisTurn,
    log: [...state.log, logLine],
  };
}

// ─── Play phase: reconnaissance ──────────────────────────────────────────────

export function reconPiece(
  state: GameState,
  reconId: string,
  targetId: string,
): GameState | string {
  if (state.phase !== 'play') return 'Not in play phase';
  if (state.attackOrReconUsedThisTurn) return 'Already attacked or reconned this turn';

  const recon = state.pieces.find(p => p.id === reconId);
  const target = state.pieces.find(p => p.id === targetId);
  if (!recon || !target) return 'Piece not found';
  if (recon.type !== 'AvionReconocimiento') return 'Only AvionReconocimiento can recon';
  if (recon.owner !== state.turn) return "Not your piece";
  if (target.owner === state.turn) return "Can't recon your own piece";
  if (!recon.pos || !target.pos) return 'Piece not on board';

  if (!hasLineOfSight(recon.pos, target.pos, state.pieces)) {
    return 'Line of sight blocked';
  }

  const newPieces = state.pieces.map(p => {
    if (p.id === target.id) {
      const revealed = p.revealedTo.includes(state.turn)
        ? p.revealedTo
        : [...p.revealedTo, state.turn];
      return { ...p, revealedTo: revealed };
    }
    return p;
  });

  const logLine = `A.R (${state.turn}) reconoce a ${pieceLabel(target.type)} (${target.owner}) en (${target.pos.r},${target.pos.c})`;

  return {
    ...state,
    pieces: newPieces,
    attackOrReconUsedThisTurn: true,
    log: [...state.log, logLine],
  };
}

// ─── Play phase: mines ───────────────────────────────────────────────────────

export function placeMine(
  state: GameState,
  minadorId: string,
  pos: { r: number; c: number },
): GameState | string {
  if (state.phase !== 'play') return 'Not in play phase';
  const minador = state.pieces.find(p => p.id === minadorId);
  if (!minador) return 'Piece not found';
  if (minador.type !== 'Minador') return 'Only Minadores can place mines';
  if (minador.owner !== state.turn) return "Not your piece";
  if (!minador.pos) return 'Minador not on board';

  const playerMines = state.mines.filter(m => m.owner === state.turn);
  if (playerMines.length >= 15) return 'No mines left';

  const existing = state.mines.find(m => m.r === pos.r && m.c === pos.c);
  if (existing) return 'Mine already at that cell';

  const logLine = `M (${state.turn}) coloca mina en (${pos.r},${pos.c})`;
  return {
    ...state,
    mines: [...state.mines, { r: pos.r, c: pos.c, owner: state.turn }],
    log: [...state.log, logLine],
  };
}

export function liftMine(
  state: GameState,
  minadorId: string,
  pos: { r: number; c: number },
): GameState | string {
  if (state.phase !== 'play') return 'Not in play phase';
  const minador = state.pieces.find(p => p.id === minadorId);
  if (!minador) return 'Piece not found';
  if (minador.type !== 'Minador') return 'Only Minadores can lift mines';
  if (minador.owner !== state.turn) return "Not your piece";

  const mine = state.mines.find(m => m.r === pos.r && m.c === pos.c);
  if (!mine) return 'No mine at that position';

  const logLine = `M (${state.turn}) levanta mina en (${pos.r},${pos.c})`;
  return {
    ...state,
    mines: state.mines.filter(m => !(m.r === pos.r && m.c === pos.c)),
    log: [...state.log, logLine],
  };
}

// ─── End turn ────────────────────────────────────────────────────────────────

export function endTurn(state: GameState): GameState | string {
  if (state.phase !== 'play') return 'Not in play phase';
  if (state.selectedNumberToken === null) return 'No token selected';

  const next: Player = state.turn === 'A' ? 'B' : 'A';
  let newTokens = transferToken(state.numberTokens, state.turn, state.selectedNumberToken);
  newTokens = enforceOlvidos(newTokens, next);

  const logLine = `${state.turn} entrega ficha ${state.selectedNumberToken} a ${next}. Turno de ${next}.`;

  return {
    ...state,
    turn: next,
    numberTokens: newTokens,
    phase: 'handoffPlay',
    selectedNumberToken: null,
    movementBudgetSpent: 0,
    combatPlaneAttackUsedThisTurn: false,
    attackOrReconUsedThisTurn: false,
    log: [...state.log, logLine],
  };
}

// ─── Confirm handoff (pass & play) ───────────────────────────────────────────

export function confirmHandoff(state: GameState): GameState {
  if (state.phase === 'handoffPlay') {
    return { ...state, phase: 'play' };
  }
  return state;
}
