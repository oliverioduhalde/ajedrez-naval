import { create } from 'zustand';
import type { GameState } from '../engine/types';
import {
  createInitialState,
  placePieceInSetup,
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
import { getReachableCells } from '../engine/movement';
import { getTargetableCells } from '../engine/lineOfSight';
import { getActualRange, getNominalRange } from '../engine/pieces';

interface UIState {
  selectedPieceId: string | null;
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

  // Play
  selectToken: (token: number) => void;
  selectPiece: (pieceId: string | null) => void;
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
  highlightedCells: [],
  targetablePieceIds: [],
  errorMessage: null,
  mode: 'idle',
});

function applyOrError(
  result: GameState | string,
  set: (fn: (s: GameStore) => Partial<GameStore>) => void,
) {
  if (typeof result === 'string') {
    set(() => ({ ui: { ...initUI(), errorMessage: result } } as Partial<GameStore>));
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

  selectToken(token) {
    const result = selectNumberToken(get().game, token);
    applyOrError(result, set);
  },

  selectPiece(pieceId) {
    const { game, ui } = get();
    if (!pieceId) {
      set(() => ({ ui: { ...ui, selectedPieceId: null, highlightedCells: [], targetablePieceIds: [], mode: 'idle' } } as Partial<GameStore>));
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
      ui: { ...ui, selectedPieceId: pieceId, highlightedCells: highlighted, targetablePieceIds: targetableIds }
    } as Partial<GameStore>));
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
    const result = movePiece(game, ui.selectedPieceId, destination);
    applyOrError(result, set);
  },

  doAttack(targetId) {
    const { game, ui } = get();
    if (!ui.selectedPieceId) return;
    const result = attackPiece(game, ui.selectedPieceId, targetId);
    applyOrError(result, set);
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
