import React from 'react';
import { useGameStore } from '../../store/gameStore';
import type { Player } from '../../engine/types';
import { useSettings } from '../../store/settingsStore';
import { useCpuStatus } from '../../store/cpuStatus';
import { CPU_LEVELS } from '../../ai/types';
import { Btn, Card, Label, mix } from '../ui';

interface Props { viewAs: Player }

const sideVar = (p: Player) => (p === 'A' ? 'var(--main)' : 'var(--rv)');

export const ActionPanel: React.FC<Props> = ({ viewAs }) => {
  const { game, ui, selectToken, selectPiece, doEndTurn } = useGameStore();
  const isMyTurn = game.turn === viewAs && game.phase === 'play';
  const tokenSelected = game.selectedNumberToken !== null;
  const tokens = game.numberTokens[viewAs];
  const budget = tokenSelected ? game.selectedNumberToken! - game.movementBudgetSpent : 0;
  const vsCpu = useSettings(s => s.vsCpu);
  const cpuLevel = useSettings(s => s.cpuLevel);
  const thinking = useCpuStatus(s => s.thinking);
  const cpuTurn = vsCpu && game.turn === 'B';
  const turnColor = sideVar(game.turn);

  return (
    <div style={{ width: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Card>
        <Label>Turno activo</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <div style={{
            width: 32, height: 32, border: `2px solid ${turnColor}`, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 800, color: turnColor, background: mix(turnColor, 14),
          }}>
            {game.turn}
          </div>
          <div>
            <div style={{ color: turnColor, fontSize: 14, fontWeight: 700 }}>
              {cpuTurn ? `CPU · ${CPU_LEVELS[cpuLevel - 1].name}` : `Jugador ${game.turn}`}
            </div>
            {cpuTurn && (
              <div style={{ fontSize: 11, color: 'var(--rv-soft)', marginTop: 2, animation: thinking ? 'pulse 1s infinite' : 'none' }}>
                {thinking ? 'Calculando…' : 'Ejecutando jugada'}
              </div>
            )}
            {tokenSelected && !cpuTurn && (
              <div style={{ fontSize: 11, color: 'var(--main-soft)', marginTop: 2 }}>
                Ficha <b style={{ color: 'var(--main)' }}>{game.selectedNumberToken}</b> · movimiento restante <b style={{ color: 'var(--main)' }}>{budget}</b>
              </div>
            )}
          </div>
        </div>
      </Card>

      {isMyTurn && !tokenSelected && (
        <Card>
          <Label>Elegí una ficha</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {tokens.map((t, i) => (
              <button
                key={`${t}-${i}`}
                onClick={() => {
                  const id = ui.selectedPieceId;
                  selectToken(t);
                  // Elegir la ficha de movimiento no debe soltar la pieza seleccionada.
                  if (id && useGameStore.getState().game.selectedNumberToken === t) selectPiece(id);
                }}
                style={{
                  width: 36, height: 36, border: '1px solid var(--main-soft)', borderRadius: 4,
                  background: 'transparent', color: 'var(--main)', fontSize: 15, fontWeight: 800, cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = mix('var(--main)', 16); }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                {t}
              </button>
            ))}
          </div>
        </Card>
      )}

      {isMyTurn && tokenSelected && (
        <Card>
          <Label>Tu jugada</Label>
          <div style={{ fontSize: 12, color: 'var(--main-soft)', lineHeight: 1.45, marginTop: 6 }}>
            {ui.selectedPieceId
              ? 'Usá el menú junto a la ficha para mover, atacar o usar su habilidad.'
              : 'Tocá una de tus fichas: junto a ella aparecen sus acciones.'}
          </div>
          <Btn accent onClick={doEndTurn} style={{ marginTop: 8, width: '100%', textAlign: 'center' }}>Terminar turno</Btn>
        </Card>
      )}

      <Card>
        <Label>Estado de flota · J.{viewAs}</Label>
        <FleetStatus viewAs={viewAs} />
      </Card>

      <Card>
        <Label>Fichas</Label>
        {(['A', 'B'] as Player[]).map(p => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            <span style={{ color: sideVar(p), fontSize: 12, fontWeight: 800, width: 16 }}>{p}</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {game.numberTokens[p].map((t, i) => (
                <span key={i} style={{
                  border: `1px solid ${mix(sideVar(p), 45)}`, borderRadius: 3,
                  padding: '1px 6px', fontSize: 12, fontWeight: 700, color: sideVar(p),
                }}>{t}</span>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
};

const FleetStatus: React.FC<{ viewAs: Player }> = ({ viewAs }) => {
  const game = useGameStore(s => s.game);
  const mine = game.pieces.filter(p => p.owner === viewAs);
  const alive = mine.filter(p => p.pos !== null);
  const damaged = alive.filter(p => p.damaged);

  return (
    <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
      <Stat label="Activas" value={alive.length} color="var(--main)" />
      <Stat label="Averiadas" value={damaged.length} color="var(--warn)" />
      <Stat label="Perdidas" value={16 - alive.length} color="var(--danger)" />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--main-mute)', marginTop: 3 }}>{label}</div>
  </div>
);
