import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { Board } from '../components/Board';
import { ActionPanel } from '../components/ActionPanel';
import { GameLog } from '../components/GameLog';
import { SystemHeader } from '../components/SystemHeader';
import { HamburgerMenu } from '../components/HamburgerMenu';
import { ViewControls } from '../components/BoardViewport';
import { PieceZoomModal } from '../components/PieceZoomModal';
import { useStackedLayout } from '../hooks/useStackedLayout';
import { Btn, Card, Label, mix } from '../ui';

const RAIL_W = 'clamp(210px, 22vw, 262px)';
const STRIP_W = 52;

const RailContent: React.FC<{ viewAs: 'A' | 'B'; onHide: () => void; hideLabel: string }> = ({ viewAs, onHide, hideLabel }) => (
  <>
    <SystemHeader />
    <Card style={{ padding: '8px 10px', flexShrink: 0 }}>
      <Label>Vista del tablero</Label>
      <div style={{ marginTop: 6 }}><ViewControls /></div>
      <Btn onClick={onHide} style={{ marginTop: 6, textAlign: 'center', fontSize: 11 }}>{hideLabel}</Btn>
    </Card>
    <ActionPanel viewAs={viewAs} />
    <GameLog fill />
  </>
);

export const GameScreen: React.FC = () => {
  const { game, resetGame } = useGameStore();
  const stacked = useStackedLayout();
  const vsCpu = useSettings(s => s.vsCpu);
  const collapsed = useSettings(s => s.railCollapsed);
  const setSetting = useSettings(s => s.set);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const viewAs = vsCpu ? 'A' : game.turn;
  const locked = vsCpu && game.turn !== 'A';

  if (game.phase === 'finished') {
    const winner = game.winner!;
    const color = winner === 'A' ? 'var(--main)' : 'var(--rv)';
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 12, padding: 12, overflowY: 'auto',
      }}>
        <div style={{ width: 'min(420px, 100%)' }}><SystemHeader /></div>
        <Card style={{ width: 'min(420px, 100%)', padding: '30px 28px', textAlign: 'center', borderColor: color }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: 'var(--main-mute)', marginBottom: 10, textTransform: 'uppercase' }}>
            Fin de la partida
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color }}>Gana el jugador {winner}</div>
          <div style={{ fontSize: 13, color: 'var(--main-soft)', marginTop: 8 }}>
            Una de sus piezas llegó a la zona rival.
          </div>
          <button
            onClick={() => resetGame()}
            style={{
              marginTop: 22, padding: '11px 28px', borderRadius: 4, cursor: 'pointer',
              border: `1px solid ${color}`, background: mix(color, 12), color,
              fontSize: 14, fontWeight: 700,
            }}
          >
            Nueva partida
          </button>
        </Card>
        <div style={{ width: 'min(420px, 100%)', height: 220, display: 'flex' }}><GameLog fill /></div>
      </div>
    );
  }

  const showFull = !stacked && !collapsed;
  const turnColor = game.turn === 'A' ? 'var(--main)' : 'var(--rv)';
  const budget = game.selectedNumberToken !== null ? game.selectedNumberToken - game.movementBudgetSpent : null;

  const expand = () => {
    if (stacked) setDrawerOpen(o => !o);
    else setSetting({ railCollapsed: false });
  };

  return (
    <div style={{ display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: 4, height: '100%', overflow: 'hidden', position: 'relative' }}>
      <Board viewAs={viewAs} locked={locked} />
      <PieceZoomModal viewAs={viewAs} />

      {showFull ? (
        <aside style={{
          display: 'flex', flexDirection: 'column', gap: 8, width: RAIL_W, flexShrink: 0,
          overflowY: 'auto', paddingRight: 2,
        }}>
          <RailContent viewAs={viewAs} onHide={() => setSetting({ railCollapsed: true })} hideLabel="Ocultar panel ›" />
        </aside>
      ) : (
        <aside style={{
          display: 'flex', flexDirection: stacked ? 'row' : 'column', alignItems: 'center', gap: stacked ? 6 : 8,
          ...(stacked ? { height: STRIP_W, padding: '0 6px', overflowX: 'auto' } : { width: STRIP_W, padding: '6px 0', overflowY: 'auto' }),
          flexShrink: 0,
          background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 6,
        }}>
          <HamburgerMenu />
          <button
            onClick={expand}
            title={stacked ? 'Abrir panel de juego' : 'Mostrar panel'}
            style={{
              width: 36, height: 36, flexShrink: 0, borderRadius: 4, cursor: 'pointer',
              border: '1px solid var(--line)', background: 'transparent', color: 'var(--main)', fontSize: 16,
            }}
          >
            {stacked ? (drawerOpen ? '▾' : '▴') : '‹'}
          </button>
          <div style={{
            width: 36, height: 36, flexShrink: 0, borderRadius: 6, border: `2px solid ${turnColor}`, color: turnColor,
            background: mix(turnColor, 14), display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800,
          }} title={`Turno del jugador ${game.turn}`}>
            {game.turn}
          </div>
          {budget !== null && (
            <div style={{ fontSize: 11, color: 'var(--main-soft)', textAlign: 'center', lineHeight: 1.2, flexShrink: 0 }} title="Movimiento restante">
              mov.<br /><b style={{ fontSize: 15, color: 'var(--main)' }}>{budget}</b>
            </div>
          )}
          <div style={stacked ? { marginLeft: 'auto', flexShrink: 0 } : { marginTop: 'auto' }}>
            <ViewControls vertical={!stacked} />
          </div>
        </aside>
      )}

      {stacked && drawerOpen && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: STRIP_W + 4, zIndex: 40,
          maxHeight: '62%',
          background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6,
          padding: 6, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto',
        }}>
          <RailContent viewAs={viewAs} onHide={() => setDrawerOpen(false)} hideLabel="Cerrar panel ▾" />
        </div>
      )}
    </div>
  );
};
