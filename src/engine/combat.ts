import type { Piece, CombatResult } from './types';
import { getCategory } from './pieces';
import { getNominalRange, getActualRange } from './pieces';

/**
 * Resolve combat between attacker and defender.
 * advancedActualRange: if true, compare actual (damage-reduced) range for a.1/a.2
 */
export function resolveCombat(
  attacker: Piece,
  defender: Piece,
  distanceCells: number, // Manhattan distance along the attack line (>=1)
  advancedActualRange: boolean,
): CombatResult {
  const aCat = getCategory(attacker.type);
  const dCat = getCategory(defender.type);

  // a) Barco attacks
  if (aCat === 'barco') {
    if (dCat === 'barco') {
      const aRange = advancedActualRange ? getActualRange(attacker) : getNominalRange(attacker.type);
      const dRange = advancedActualRange ? getActualRange(defender) : getNominalRange(defender.type);
      if (defender.damaged) return 'HUNDIDO';           // a.3
      if (aRange < dRange) return 'AVERIADO';           // a.1: attacker < defender → averiado
      return 'HUNDIDO';                                  // a.2: equal or greater → hundido
    }
    if (dCat === 'submarino') {
      if (attacker.type === 'Fragata') return 'HUNDIDO'; // a.5
      return 'ILESO';                                    // a.4
    }
    if (dCat === 'avion') {
      if (distanceCells === 1) return 'DERRIBADO';      // a.6
      return 'ILESO';                                    // a.7
    }
  }

  // b) Submarino attacks
  if (aCat === 'submarino') {
    if (dCat === 'barco') {
      if (defender.type === 'Fragata') return 'ILESA';  // b.2
      return 'HUNDIDO';                                  // b.1
    }
    if (dCat === 'submarino') return 'ILESO';           // b.3
    if (dCat === 'avion') return 'DERRIBADO';           // b.4
  }

  // c) Avion attacks
  if (aCat === 'avion') {
    if (dCat === 'barco') return 'ILESO';               // c.1
    if (dCat === 'submarino') return 'HUNDIDO';         // c.2
    if (dCat === 'avion') return 'DERRIBADO';           // c.3
  }

  return 'ILESO';
}

export function isFatalResult(result: CombatResult): boolean {
  return result === 'HUNDIDO' || result === 'DERRIBADO';
}

export function combatResultLabel(result: CombatResult): string {
  return result;
}
