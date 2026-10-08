import type { GameState, Player } from '../engine/types';

export type CpuLevel = 1 | 2 | 3 | 4 | 5;

export const CPU_LEVELS: { level: CpuLevel; name: string; blurb: string }[] = [
  { level: 1, name: 'GRUMETE', blurb: 'Casi al azar: se mueve sin plan' },
  { level: 2, name: 'MARINERO', blurb: 'Codicioso: ataca lo que ve, avanza y siembra minas cerca de su zona' },
  { level: 3, name: 'OFICIAL', blurb: 'Planifica el turno completo e imagina tus piezas ocultas' },
  { level: 4, name: 'COMANDANTE', blurb: 'Monte Carlo con información oculta: simula miles de partidas (≈0,3 s por jugada)' },
  { level: 5, name: 'ALMIRANTE', blurb: 'Monte Carlo profundo y con memoria: piensa más (≈1 s por jugada)' },
];

export type Cell = { r: number; c: number };

export type CpuAction =
  | { kind: 'selectToken'; token: number }
  | { kind: 'move'; pieceId: string; to: Cell }
  | { kind: 'attack'; attackerId: string; targetId: string }
  | { kind: 'recon'; pieceId: string; targetId: string }
  | { kind: 'placeMine'; pieceId: string; at: Cell }
  | { kind: 'liftMine'; pieceId: string; at: Cell }
  | { kind: 'endTurn' };

export interface Placement {
  pieceId: string;
  pos: Cell;
}

export interface CpuOptions {
  rng?: () => number;
  iterations?: number;
  timeBudgetMs?: number;
}

export interface CpuApi {
  requestAction(state: GameState, me: Player, level: CpuLevel): Promise<CpuAction>;
  requestSetup(state: GameState, me: Player, level: CpuLevel): Promise<Placement[]>;
}
