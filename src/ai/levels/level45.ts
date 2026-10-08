import type { GameState } from '../../engine/types';
import type { CpuAction } from '../types';
import type { LevelContext } from '../view';
import { observeHidden } from './ismctsBelief';
import { searchAction, searchDetailed, type SearchConfig, type SearchOutcome } from './ismcts';
import type { PolicyParams } from './ismctsPolicy';

export { clearSearchMemory, setSearchMemory } from './ismcts';
export type { SearchConfig, SearchOutcome } from './ismcts';

const POLICY_L4: PolicyParams = {
  epsilon: 0.06,
  attackThreshold: 1.5,
  runnerNoise: 1.2,
  tokenPower: 1.5,
  riskTaking: 0.2,
  reconPlayer: null,
  reconProb: 0.5,
  defend: false,
  hunt: true,
  huntThreshold: 2,
  thriftyToken: false,
  greedyOpp: false,
  greedyAll: false,
  oppSamples: 1,
};

export const L4_CONFIG: SearchConfig = {
  name: 'L4',
  exploration: 0.3,
  priorBias: 0.25,
  widenBase: 5,
  widenScale: 1.2,
  maxChildrenSelf: 12,
  maxChildrenOpp: 5,
  maxDepth: 14,
  horizonEnds: 2,
  defaultTimeMs: 300,
  reuseBudgetFactor: 0.5,
  minIterations: 64,
  policy: POLICY_L4,
  infoBonus: 0.01,
  belief: 'hard',
  reuse: true,
  earlyStop: true,
  softStopShare: 0,
  maxNodes: 40000,
  paired: true,
  finalByMean: false,
  worldPoolMax: 256,
  leafWinCheck: true,
};

export const L5_CONFIG: SearchConfig = {
  ...L4_CONFIG,
  name: 'L5',
  defaultTimeMs: 1000,
  reuseBudgetFactor: 0.4,
  maxChildrenSelf: 16,
  maxChildrenOpp: 6,
  maxDepth: 18,
  horizonEnds: 3,
  minIterations: 128,
  policy: { ...POLICY_L4, epsilon: 0.04, runnerNoise: 0.8, defend: true, thriftyToken: true },
  belief: 'weighted',
  reuse: true,
  softStopShare: 0.7,
  maxNodes: 120000,
};

function withRecon(cfg: SearchConfig, me: LevelContext['me']): SearchConfig {
  return { ...cfg, policy: { ...cfg.policy, reconPlayer: me } };
}

export function level4Action(ctx: LevelContext): CpuAction {
  return searchAction(ctx, withRecon(L4_CONFIG, ctx.me));
}

export function level5Action(ctx: LevelContext): CpuAction {
  observeHidden(ctx.view);
  return searchAction(ctx, withRecon(L5_CONFIG, ctx.me));
}

export function searchLevel(level: 4 | 5, ctx: LevelContext, override?: Partial<SearchConfig>, sampler?: (rng: () => number) => GameState): SearchOutcome {
  const base = level === 4 ? L4_CONFIG : L5_CONFIG;
  if (level === 5) observeHidden(ctx.view);
  return searchDetailed(ctx, withRecon({ ...base, ...override }, ctx.me), sampler);
}
