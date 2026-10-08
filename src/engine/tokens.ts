import type { Player, GameState } from './types';

export const INITIAL_TOKENS: number[] = [2, 3, 4, 5, 6];
export const FULL_TOKEN_COUNT = 6; // including the "1" start token

// After setup the "1" token is awarded to the starting player; each player gets [2..6]
export function initialTokens(): Record<Player, number[]> {
  return {
    A: [2, 3, 4, 5, 6],
    B: [2, 3, 4, 5, 6],
  };
}

/**
 * After a player ends their turn with a selected token, transfer it to the opponent.
 */
export function transferToken(
  tokens: Record<Player, number[]>,
  from: Player,
  token: number,
): Record<Player, number[]> {
  const opponent: Player = from === 'A' ? 'B' : 'A';
  return {
    ...tokens,
    [from]: tokens[from].filter(t => t !== token),
    [opponent]: [...tokens[opponent], token].sort((a, b) => a - b),
  };
}

/**
 * Enforce "olvidos" rule: if a player starts with < 6 tokens, they claim
 * the highest tokens from the opponent to reach 6.
 */
export function enforceOlvidos(
  tokens: Record<Player, number[]>,
  player: Player,
): Record<Player, number[]> {
  const needed = FULL_TOKEN_COUNT - tokens[player].length;
  if (needed <= 0) return tokens;

  const opponent: Player = player === 'A' ? 'B' : 'A';
  const oppSorted = [...tokens[opponent]].sort((a, b) => b - a); // descending
  const claimed = oppSorted.slice(0, needed);
  const remaining = oppSorted.slice(needed).sort((a, b) => a - b);

  return {
    ...tokens,
    [player]: [...tokens[player], ...claimed].sort((a, b) => a - b),
    [opponent]: remaining,
  };
}
