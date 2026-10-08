import React from 'react';
import { useGameStore } from '../../store/gameStore';
import type { Player } from '../../engine/types';

const P  = '#00ff66';
const PD = '#00aa44';
const PDD = '#004d1a';
const AM = '#ffaa00'; // amber for enemy/warning

interface Props { viewAs: Player }

export const ActionPanel: React.FC<Props> = ({ viewAs }) => {
  const { game, ui, selectToken, setMode, doEndTurn, clearError } = useGameStore();
  const isMyTurn = game.turn === viewAs && game.phase === 'play';
  const tokenSelected = game.selectedNumberToken !== null;
  const tokens = game.numberTokens[viewAs];
  const budget = tokenSelected ? game.selectedNumberToken! - game.movementBudgetSpent : 0;
  const minesLeft = 15 - game.mines.filter(m => m.owner === viewAs).length;

  return (
    <div style={{
      width: '100%',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>

      {/* Error */}
      {ui.errorMessage && (
        <div onClick={clearError} style={{
          border: `1px solid #ff4444`,
          background: 'rgba(40,0,0,0.9)',
          color: '#ff6666',
          padding: '6px 8px',
          fontSize: 10,
          cursor: 'pointer',
          letterSpacing: 0.5,
          lineHeight: 1.4,
          boxShadow: '0 0 8px rgba(255,0,0,0.3)',
        }}>
          ▸ ERR: {ui.errorMessage}
        </div>
      )}

      {/* Turn card */}
      <CRTCard>
        <Label>TURNO ACTIVO</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <div style={{
            width: 28, height: 28, border: `1px solid ${game.turn === 'A' ? P : AM}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700,
            color: game.turn === 'A' ? P : AM,
            boxShadow: `0 0 8px ${game.turn === 'A' ? P : AM}`,
          }}>
            {game.turn}
          </div>
          <div>
            <div style={{ color: game.turn === 'A' ? P : AM, fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
              JUGADOR {game.turn}
            </div>
            {tokenSelected && (
              <div style={{ fontSize: 9, color: PD, marginTop: 1 }}>
                FICHA <span style={{ color: P }}>{game.selectedNumberToken}</span>
                {' '}· RESTO <span style={{ color: '#00ffaa' }}>{budget}</span>
              </div>
            )}
          </div>
        </div>
      </CRTCard>

      {/* Token selector */}
      {isMyTurn && !tokenSelected && (
        <CRTCard>
          <Label>SELECCIONAR FICHA</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {tokens.map((t, i) => (
              <button key={`${t}-${i}`} onClick={() => selectToken(t)}
                style={{
                  width: 30, height: 30,
                  border: `1px solid ${PD}`,
                  background: 'transparent',
                  color: P, fontSize: 13, fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: `0 0 4px ${PDD}`,
                  letterSpacing: 0,
                  transition: 'all 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = PDD; e.currentTarget.style.boxShadow = `0 0 10px ${P}`; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = `0 0 4px ${PDD}`; }}
              >
                {t}
              </button>
            ))}
          </div>
        </CRTCard>
      )}

      {/* Actions */}
      {isMyTurn && tokenSelected && (
        <CRTCard>
          <Label>ACCIONES</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
            <CRTBtn icon="MOVER"    active={ui.mode==='moving'}
              onClick={() => setMode(ui.mode==='moving' ? 'idle' : 'moving')} />
            <CRTBtn icon="ATACAR"   active={ui.mode==='attacking'}
              disabled={game.attackOrReconUsedThisTurn}
              onClick={() => !game.attackOrReconUsedThisTurn && setMode(ui.mode==='attacking' ? 'idle' : 'attacking')} />
            <CRTBtn icon="RECONOCER" active={ui.mode==='reconning'}
              disabled={game.attackOrReconUsedThisTurn}
              onClick={() => !game.attackOrReconUsedThisTurn && setMode(ui.mode==='reconning' ? 'idle' : 'reconning')} />
            <CRTBtn icon={`MINAR [${minesLeft}]`} active={ui.mode==='placingMine'}
              onClick={() => setMode(ui.mode==='placingMine' ? 'idle' : 'placingMine')} />
            <CRTBtn icon="LEVANTAR" active={ui.mode==='liftingMine'}
              onClick={() => setMode(ui.mode==='liftingMine' ? 'idle' : 'liftingMine')} />
            <div style={{ height: 1, background: PDD, margin: '3px 0' }} />
            <CRTBtn icon="▸ FIN TURNO" accent onClick={doEndTurn} />
          </div>
        </CRTCard>
      )}

      {/* Fleet status */}
      <CRTCard>
        <Label>ESTADO FLOTA · J.{viewAs}</Label>
        <FleetStatus viewAs={viewAs} />
      </CRTCard>

      {/* Token inventory */}
      <CRTCard>
        <Label>FICHAS</Label>
        {(['A','B'] as Player[]).map(p => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
            <span style={{ color: p === 'A' ? P : AM, fontSize: 10, fontWeight: 700, width: 12 }}>{p}:</span>
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {game.numberTokens[p].map((t, i) => (
                <span key={i} style={{
                  border: `1px solid ${p === 'A' ? PDD : '#553300'}`,
                  padding: '1px 4px', fontSize: 10, fontWeight: 700,
                  color: p === 'A' ? PD : '#cc8800',
                }}>{t}</span>
              ))}
            </div>
          </div>
        ))}
      </CRTCard>
    </div>
  );
};

// ── sub-components ────────────────────────────────────────────────────────────

const CRTCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    border: '1px solid #003311',
    background: 'rgba(0,15,5,0.85)',
    padding: '8px 10px',
    position: 'relative',
  }}>
    {/* corner ticks */}
    {[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy], i) => (
      <div key={i} style={{
        position: 'absolute',
        top: sy < 0 ? -1 : 'auto', bottom: sy > 0 ? -1 : 'auto',
        left: sx < 0 ? -1 : 'auto', right: sx > 0 ? -1 : 'auto',
        width: 5, height: 5,
        borderTop:    sy < 0 ? `1px solid #00ff66` : 'none',
        borderBottom: sy > 0 ? `1px solid #00ff66` : 'none',
        borderLeft:   sx < 0 ? `1px solid #00ff66` : 'none',
        borderRight:  sx > 0 ? `1px solid #00ff66` : 'none',
      }} />
    ))}
    {children}
  </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 8, letterSpacing: 2, color: '#005522', textTransform: 'uppercase' }}>
    {children}
  </div>
);

const CRTBtn: React.FC<{
  icon: string; active?: boolean; disabled?: boolean; accent?: boolean; onClick?: () => void;
}> = ({ icon, active, disabled, accent, onClick }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      padding: '5px 8px',
      border: `1px solid ${accent ? '#00ff66' : active ? '#00ff66' : disabled ? '#002210' : '#003311'}`,
      background: accent ? 'rgba(0,255,100,0.12)' : active ? 'rgba(0,255,100,0.08)' : 'transparent',
      color: disabled ? '#002d12' : active || accent ? '#00ff66' : '#00aa44',
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
      textAlign: 'left', width: '100%',
      boxShadow: active || accent ? '0 0 6px rgba(0,255,80,0.3)' : 'none',
      textShadow: active || accent ? '0 0 8px #00ff66' : 'none',
      transition: 'all 0.1s',
    }}
  >
    ▸ {icon}
  </button>
);

const FleetStatus: React.FC<{ viewAs: Player }> = ({ viewAs }) => {
  const { game } = useGameStore();
  const mine = game.pieces.filter(p => p.owner === viewAs);
  const alive = mine.filter(p => p.pos !== null);
  const damaged = alive.filter(p => p.damaged);

  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
      <FStat label="ACTV" value={alive.length} color="#00ff66" />
      <FStat label="AVER" value={damaged.length} color="#ffaa00" />
      <FStat label="PERD" value={16 - alive.length} color="#ff4444" />
    </div>
  );
};

const FStat: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <div style={{ textAlign: 'center' }}>
    <div style={{ fontSize: 16, fontWeight: 700, color, textShadow: `0 0 8px ${color}`, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 7, color: '#005522', letterSpacing: 1 }}>{label}</div>
  </div>
);
