export type Player = 'A' | 'B';

export type UnitType =
  | 'Acorazado'
  | 'Crucero'
  | 'Fragata'
  | 'Minador'
  | 'Submarino'
  | 'AvionCombate'
  | 'AvionReconocimiento';

export type UnitCategory = 'barco' | 'submarino' | 'avion';

export interface Piece {
  id: string;
  owner: Player;
  type: UnitType;
  pos: { r: number; c: number } | null; // null = off board (destroyed)
  damaged: boolean;       // only ships (barcos)
  revealedTo: Player[];   // fog of war: players who know this piece's identity
}

export interface Mine {
  r: number;
  c: number;
  owner: Player;
}

export interface GameOptions {
  useDice: boolean;
  advancedActualRange: boolean;  // compare actual (damaged) range instead of nominal
  randomIslands: boolean;
  presentation: {
    mode: 'passAndPlay' | 'twoDevices';
    handoffPin: boolean;
  };
}

export interface GameState {
  pieces: Piece[];
  mines: Mine[];
  turn: Player;
  numberTokens: Record<Player, number[]>;
  phase: 'setup' | 'setupB' | 'handoff' | 'play' | 'handoffPlay' | 'finished';
  setupPlayer: Player; // which player is currently placing pieces in setup
  combatPlaneAttackUsedThisTurn: boolean;
  attackOrReconUsedThisTurn: boolean;
  movementBudgetSpent: number;
  selectedNumberToken: number | null; // the token chosen for this turn
  options: GameOptions;
  log: string[];
  winner: Player | null;
  // For setup phase: which pieces have been placed
  setupPlacedPieceIds: string[];
}

export type CombatResult =
  | 'HUNDIDO'
  | 'DERRIBADO'
  | 'AVERIADO'
  | 'ILESO'
  | 'ILESA';
