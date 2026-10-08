import { create } from 'zustand';
import { useGameStore } from './gameStore';

/**
 * ¿Ya se eligieron las facciones de esta partida? La pantalla de elección aparece cada vez que
 * se empieza una partida nueva (la primera vez y después de cada reinicio).
 */
interface FactionStore {
  confirmed: boolean;
  confirm: () => void;
}

export const useFactionStore = create<FactionStore>(set => ({
  confirmed: false,
  confirm: () => set({ confirmed: true }),
}));

// Al volver a la fase de despliegue desde cualquier otra (nueva partida, cambio de modo) se vuelve a elegir.
useGameStore.subscribe((s, prev) => {
  if (s.game.phase === 'setup' && prev.game.phase !== 'setup') useFactionStore.setState({ confirmed: false });
});
