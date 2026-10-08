import { create } from 'zustand';
import type { GameState, Player } from '../engine/types';
import {
  createInitialState,
  placePieceInSetup,
  unplacePieceInSetup,
  finishSetup,
  selectNumberToken,
  movePiece,
  attackPiece,
  reconPiece,
  placeMine,
  liftMine,
  endTurn,
  confirmHandoff,
  canSeeIdentity,
} from '../engine/gameEngine';
import { findPath, getReachableCells } from '../engine/movement';
import { randomDeployment, taskForceDeployment } from '../engine/deployment';
import { getTargetableCells } from '../engine/lineOfSight';
import { getActualRange, getNominalRange } from '../engine/pieces';
import { resolveCombat } from '../engine/combat';
import { esError } from '../ui/messages';
import { useSettings } from './settingsStore';
import { emitFx } from '../fx/emit';

interface UIState {
  selectedPieceId: string | null;
  inspectId: string | null;
  zoomPieceId: string | null;
  highlightedCells: { r: number; c: number }[];
  targetablePieceIds: string[];
  errorMessage: string | null;
  mode: 'idle' | 'moving' | 'attacking' | 'reconning' | 'placingMine' | 'liftingMine';
}

interface GameStore {
  game: GameState;
  ui: UIState;

  // Setup
  placePiece: (pieceId: string, pos: { r: number; c: number }) => void;
  finishSetup: () => void;
  unplacePiece: (pieceId: string) => void;
  deployFleet: (mode: 'random' | 'taskforce' | 'clear') => void;

  // Play
  selectToken: (token: number) => void;
  selectPiece: (pieceId: string | null) => void;
  inspect: (pieceId: string | null) => void;
  openPieceZoom: (pieceId: string) => void;
  closePieceZoom: () => void;
  setMode: (mode: UIState['mode']) => void;
  doMove: (destination: { r: number; c: number }) => void;
  doAttack: (targetId: string) => void;
  doRecon: (targetId: string) => void;
  doPlaceMine: (pos: { r: number; c: number }) => void;
  doLiftMine: (pos: { r: number; c: number }) => void;
  doEndTurn: () => void;
  confirmHandoff: () => void;

  resetGame: (options?: Partial<GameState['options']>) => void;
  clearError: () => void;
}

const initUI = (): UIState => ({
  selectedPieceId: null,
  inspectId: null,
  zoomPieceId: null,
  highlightedCells: [],
  targetablePieceIds: [],
  errorMessage: null,
  mode: 'idle',
});

/** Quién mira la pantalla: contra la CPU siempre A; en mesa compartida, quien tiene el turno. */
function spectator(game: GameState): Player {
  return useSettings.getState().vsCpu ? 'A' : game.turn;
}

function applyOrError(
  result: GameState | string,
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  if (typeof result === 'string') {
    set(s => ({ ui: { ...s.ui, errorMessage: esError(result) } } as Partial<GameStore>));
  } else {
    set(() => ({ game: result, ui: initUI() } as Partial<GameStore>));
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  game: createInitialState(),
  ui: initUI(),

  placePiece(pieceId, pos) {
    const result = placePieceInSetup(get().game, pieceId, pos);
    applyOrError(result, set);
  },

  finishSetup() {
    const result = finishSetup(get().game);
    applyOrError(result, set);
  },

  unplacePiece(pieceId) {
    const result = unplacePieceInSetup(get().game, pieceId);
    applyOrError(result, set);
  },

  deployFleet(mode) {
    let state = get().game;
    if (state.phase !== 'setup' && state.phase !== 'setupB') return;
    const player = state.setupPlayer;
    for (const p of state.pieces.filter(x => x.owner === player && x.pos)) {
      const r = unplacePieceInSetup(state, p.id);
      if (typeof r === 'string') { applyOrError(r, set); return; }
      state = r;
    }
    if (mode !== 'clear') {
      const placements = mode === 'random'
        ? randomDeployment(player, state.pieces)
        : taskForceDeployment(player, state.pieces);
      for (const pl of placements) {
        const r = placePieceInSetup(state, pl.pieceId, pl.pos);
        if (typeof r === 'string') { applyOrError(r, set); return; }
        state = r;
      }
    }
    applyOrError(state, set);
  },

  selectToken(token) {
    const result = selectNumberToken(get().game, token);
    applyOrError(result, set);
  },

  selectPiece(pieceId) {
    const { game, ui } = get();
    if (!pieceId) {
      set(() => ({ ui: { ...ui, selectedPieceId: null, inspectId: null, highlightedCells: [], targetablePieceIds: [], mode: 'idle' } } as Partial<GameStore>));
      return;
    }
    const piece = game.pieces.find(p => p.id === pieceId);
    if (!piece || !piece.pos) return;

    let highlighted: { r: number; c: number }[] = [];
    let targetableIds: string[] = [];

    if (ui.mode === 'moving' || ui.mode === 'idle') {
      const budget = (game.selectedNumberToken ?? 0) - game.movementBudgetSpent;
      highlighted = getReachableCells(piece, budget, game.pieces, game.mines);
    }

    if (ui.mode === 'attacking' || ui.mode === 'reconning') {
      const range = game.options.advancedActualRange
        ? getActualRange(piece)
        : getNominalRange(piece.type);
      const targetCells = getTargetableCells(piece.pos.r, piece.pos.c, range, game.pieces, game.mines);
      const targetCellSet = new Set(targetCells.map(c => `${c.r},${c.c}`));
      targetableIds = game.pieces
        .filter(p => p.owner !== game.turn && p.pos && targetCellSet.has(`${p.pos.r},${p.pos.c}`))
        .map(p => p.id);
    }

    set(() => ({
      ui: { ...ui, selectedPieceId: pieceId, inspectId: pieceId, highlightedCells: highlighted, targetablePieceIds: targetableIds }
    } as Partial<GameStore>));
  },

  inspect(pieceId) {
    set(s => ({ ui: { ...s.ui, inspectId: pieceId } } as Partial<GameStore>));
  },

  openPieceZoom(pieceId) {
    set(s => ({ ui: { ...s.ui, zoomPieceId: pieceId, inspectId: pieceId } } as Partial<GameStore>));
  },

  closePieceZoom() {
    set(s => ({ ui: { ...s.ui, zoomPieceId: null } } as Partial<GameStore>));
  },

  setMode(mode) {
    set(s => ({ ui: { ...s.ui, mode, highlightedCells: [], targetablePieceIds: [] } } as Partial<GameStore>));
    // Re-select to refresh highlights
    const { ui } = get();
    if (ui.selectedPieceId) get().selectPiece(ui.selectedPieceId);
  },

  doMove(destination) {
    const { game, ui } = get();
    if (!ui.selectedPieceId) return;
    const pieceId = ui.selectedPieceId;
    const piece = game.pieces.find(p => p.id === pieceId);

    // El motor mueve de a una casilla: un destino lejano se recorre paso a paso.
    const path = piece ? findPath(piece, destination, game.pieces, game.mines) : null;
    const steps = path ?? [destination];
    if (piece && path && game.selectedNumberToken !== null) {
      const remaining = game.selectedNumberToken - game.movementBudgetSpent;
      if (path.length * (piece.damaged ? 2 : 1) > remaining) {
        applyOrError('Not enough movement budget', set);
        return;
      }
    }

    let state = game;
    let applied = 0;
    for (const step of steps) {
      const result = movePiece(state, pieceId, step);
      if (typeof result === 'string') { applyOrError(result, set); return; }
      state = result;
      applied += 1;
      if (state.phase !== 'play') break;
      if (!state.pieces.find(p => p.id === pieceId)?.pos) break;
    }
    applyOrError(state, set);
    if (piece && piece.pos && state !== game) {
      const after = state.pieces.find(p => p.id === pieceId);
      const taken = steps.slice(0, applied);
      const blasted = !after?.pos;
      emitFx({
        kind: 'move', pieceId, unit: piece.type, owner: piece.owner, from: piece.pos, path: taken,
        audible: canSeeIdentity(piece, spectator(game)), endsInBlast: blasted,
      });
      if (blasted) {
        emitFx({
          kind: 'mineBlast', pieceId, unit: piece.type, owner: piece.owner,
          at: taken[taken.length - 1], damaged: piece.damaged,
        });
      }
    }
    if (get().game.phase === 'play') {
      const moved = get().game.pieces.find(p => p.id === pieceId);
      if (moved?.pos) get().selectPiece(pieceId);
    }
  },

  doAttack(targetId) {
    const { game, ui } = get();
    if (!ui.selectedPieceId) return;
    const result = attackPiece(game, ui.selectedPieceId, targetId);
    applyOrError(result, set);
    if (typeof result !== 'string') {
      const attacker = game.pieces.find(p => p.id === ui.selectedPieceId);
      const target = game.pieces.find(p => p.id === targetId);
      if (attacker?.pos && target?.pos) {
        const distance = Math.abs(attacker.pos.r - target.pos.r) + Math.abs(attacker.pos.c - target.pos.c);
        emitFx({
          kind: 'attack',
          attackerId: attacker.id, attackerUnit: attacker.type, attackerOwner: attacker.owner, from: attacker.pos,
          targetId: target.id, targetUnit: target.type, targetOwner: target.owner, to: target.pos,
          distance,
          result: resolveCombat(attacker, target, distance, game.options.advancedActualRange),
          targetWasDamaged: target.damaged,
        });
      }
    }
  },

  doRecon(targetId) {
    const { game, ui } = get();
    if (!ui.selectedPieceId) return;
    const result = reconPiece(game, ui.selectedPieceId, targetId);
    applyOrError(result, set);
  },

  doPlaceMine(pos) {
    const { game, ui } = get();
    if (!ui.selectedPieceId) return;
    const result = placeMine(game, ui.selectedPieceId, pos);
    applyOrError(result, set);
  },

  doLiftMine(pos) {
    const { game, ui } = get();
    if (!ui.selectedPieceId) return;
    const result = liftMine(game, ui.selectedPieceId, pos);
    applyOrError(result, set);
  },

  doEndTurn() {
    const result = endTurn(get().game);
    applyOrError(result, set);
  },

  confirmHandoff() {
    const newGame = confirmHandoff(get().game);
    set(() => ({ game: newGame, ui: initUI() } as Partial<GameStore>));
  },

  resetGame(options) {
    set(() => ({ game: createInitialState(options), ui: initUI() } as Partial<GameStore>));
  },

  clearError() {
    set(s => ({ ui: { ...s.ui, errorMessage: null } } as Partial<GameStore>));
  },
}));

export { canSeeIdentity };
