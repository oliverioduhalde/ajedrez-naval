import type { GameState, Player } from '../engine/types';

export type CpuLevel = 1 | 2 | 3 | 4 | 5;

export const CPU_LEVELS: { level: CpuLevel; name: string; blurb: string }[] = [
  { level: 1, name: 'GRUMETE', blurb: 'Casi al azar, avanza sin plan' },
  { level: 2, name: 'MARINERO', blurb: 'Codicioso: ataca lo que ve' },
  { level: 3, name: 'OFICIAL', blurb: 'Planifica el turno completo' },
  { level: 4, name: 'COMANDANTE', blurb: 'Monte Carlo con info oculta' },
  { level: 5, name: 'ALMIRANTE', blurb: 'Monte Carlo profundo + memoria' },
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
