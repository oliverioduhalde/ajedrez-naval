import type { Player } from './types';

export const INITIAL_TOKENS: number[] = [2, 3, 4, 5, 6];
export const FULL_TOKEN_COUNT = 6; // al iniciar el turno hay que tener 6 (incluye la ficha "1" del que empieza)

/**
 * Reglamento §2.2: serie del 2 al 6 por jugador, más una única ficha "1" que se sortea:
 * quien la obtiene comienza. Así el que empieza tiene las 6 fichas (1..6) y el otro 5 (2..6);
 * a partir de ahí cada ficha jugada se entrega al rival, y por eso aparecen números repetidos.
 */
export function initialTokens(starter: Player = 'A'): Record<Player, number[]> {
  const other: Player = starter === 'A' ? 'B' : 'A';
  return {
    [starter]: [1, 2, 3, 4, 5, 6],
    [other]: [2, 3, 4, 5, 6],
  } as Record<Player, number[]>;
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
