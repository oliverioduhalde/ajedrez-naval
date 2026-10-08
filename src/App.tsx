import { useGameStore } from './store/gameStore';
import { SetupScreen } from './ui/screens/SetupScreen';
import { HandoffScreen } from './ui/screens/HandoffScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { CRTOverlay } from './ui/components/CRTOverlay';
import { SystemHeader } from './ui/components/SystemHeader';

export default function App() {
  const phase = useGameStore(s => s.game.phase);
  const inPlay = phase === 'play' || phase === 'finished';

  return (
    <CRTOverlay>
      <div style={{
        height: '100dvh', width: '100vw',
        display: 'flex', flexDirection: 'column',
        background: '#000a02',
        overflow: 'hidden',
      }}>
        {!inPlay && <SystemHeader variant="bar" />}

        <main style={{
          flex: 1, minHeight: 0, overflow: 'hidden',
          padding: inPlay ? '6px 8px' : '8px 12px',
        }}>
          {(phase === 'setup' || phase === 'setupB') && <SetupScreen />}
          {phase === 'handoffPlay' && <HandoffScreen />}
          {inPlay && <GameScreen />}
        </main>
      </div>
    </CRTOverlay>
  );
}
