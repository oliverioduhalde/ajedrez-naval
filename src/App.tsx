import { useGameStore } from './store/gameStore';
import { SetupScreen } from './ui/screens/SetupScreen';
import { FactionScreen } from './ui/screens/FactionScreen';
import { useFactionStore } from './store/factionStore';
import { HandoffScreen } from './ui/screens/HandoffScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { ScreenEffects } from './ui/components/ScreenEffects';
import { useSettings } from './store/settingsStore';
import { useCpuDriver } from './ui/hooks/useCpuDriver';

export default function App() {
  const phase = useGameStore(s => s.game.phase);
  const vsCpu = useSettings(s => s.vsCpu);
  const factionsConfirmed = useFactionStore(s => s.confirmed);
  useCpuDriver();
  const inPlay = phase === 'play' || phase === 'finished' || (vsCpu && phase === 'handoffPlay');

  return (
    <ScreenEffects>
      <div style={{ height: '100dvh', width: '100vw', background: 'var(--bg)', overflow: 'hidden' }}>
        <main style={{ height: '100%', overflow: 'hidden', padding: 4 }}>
          {phase === 'setup' && !factionsConfirmed && <FactionScreen />}
          {(phase === 'setupB' || (phase === 'setup' && factionsConfirmed)) && <SetupScreen />}
          {phase === 'handoffPlay' && !vsCpu && <HandoffScreen />}
          {inPlay && <GameScreen />}
        </main>
      </div>
    </ScreenEffects>
  );
}
