import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { playAnthem, stopAnthem } from '../../fx/anthems/player';

/** Cuando termina la partida suena, en 8 bit, la parte más famosa del himno de la facción ganadora. */
export function useVictoryAnthem(): void {
  const phase = useGameStore(s => s.game.phase);
  const winner = useGameStore(s => s.game.winner);
  const factionA = useSettings(s => s.factionA);
  const factionB = useSettings(s => s.factionB);
  useEffect(() => {
    if (phase !== 'finished' || !winner) return;
    playAnthem(winner === 'A' ? factionA : factionB);
    return () => stopAnthem();
  }, [phase, winner, factionA, factionB]);
}
