import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';

const P = '#00ff66';
const PD = '#004d1a';
const BG = 'rgba(0,10,2,0.97)';

const Toggle: React.FC<{
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  desc?: string;
}> = ({ label, value, onChange, desc }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: value ? P : '#00aa44', fontSize: 13, letterSpacing: 1 }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        style={{
          width: 44, height: 22,
          borderRadius: 11,
          border: `1px solid ${value ? P : '#004d1a'}`,
          background: value ? PD : '#001206',
          cursor: 'pointer',
          position: 'relative',
          transition: 'all 0.2s',
          boxShadow: value ? `0 0 8px ${P}` : 'none',
        }}
      >
        <div style={{
          position: 'absolute',
          top: 2, left: value ? 24 : 2,
          width: 16, height: 16,
          borderRadius: '50%',
          background: value ? P : '#00aa44',
          transition: 'left 0.2s',
          boxShadow: value ? `0 0 6px ${P}` : 'none',
        }} />
      </button>
    </div>
    {desc && <div style={{ fontSize: 10, color: '#005522', marginTop: 3, letterSpacing: 0.5 }}>{desc}</div>}
  </div>
);

export const HamburgerMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { game, resetGame } = useGameStore();
  const opts = game.options;

  function update(patch: Partial<typeof opts>) {
    resetGame({ ...opts, ...patch });
  }

  const lines = { width: 22, height: 2, bg: P, borderRadius: 1 };

  return (
    <>
      {/* Hamburger button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none',
          border: `1px solid ${open ? P : PD}`,
          borderRadius: 4,
          cursor: 'pointer',
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          boxShadow: open ? `0 0 10px ${P}` : 'none',
          transition: 'all 0.15s',
        }}
        title="Opciones"
      >
        <div style={{
          ...lines,
          transform: open ? 'rotate(45deg) translate(4px, 4px)' : 'none',
          transition: 'transform 0.2s',
        }} />
        <div style={{
          ...lines,
          opacity: open ? 0 : 1,
          transition: 'opacity 0.2s',
        }} />
        <div style={{
          ...lines,
          transform: open ? 'rotate(-45deg) translate(4px, -4px)' : 'none',
          transition: 'transform 0.2s',
        }} />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0,
            zIndex: 10000,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed',
        top: 0, right: 0,
        height: '100vh',
        width: 300,
        background: BG,
        borderLeft: `1px solid ${PD}`,
        boxShadow: open ? `-4px 0 40px rgba(0,255,100,0.15)` : 'none',
        zIndex: 10001,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        padding: '20px 24px',
        overflowY: 'auto',
      }}>
        {/* Title */}
        <div style={{
          fontSize: 11, letterSpacing: 4, color: '#00aa44',
          textTransform: 'uppercase', marginBottom: 4,
        }}>
          ⚙ SISTEMA
        </div>
        <div style={{
          fontSize: 18, fontWeight: 700, color: P,
          textShadow: `0 0 10px ${P}`,
          marginBottom: 28,
          letterSpacing: 2,
        }}>
          CONFIGURACIÓN
        </div>

        <div style={{ height: 1, background: PD, marginBottom: 24, opacity: 0.5 }} />

        {/* Options */}
        <div style={{ fontSize: 10, color: '#005522', letterSpacing: 3, marginBottom: 16, textTransform: 'uppercase' }}>
          Modo de turno
        </div>
        <Toggle
          label="DADOS"
          value={opts.useDice}
          onChange={v => update({ useDice: v })}
          desc="Variante: el movimiento se determina con dados en vez de fichas-número"
        />

        <div style={{ height: 1, background: PD, marginBottom: 20, opacity: 0.3 }} />
        <div style={{ fontSize: 10, color: '#005522', letterSpacing: 3, marginBottom: 16, textTransform: 'uppercase' }}>
          Combate
        </div>
        <Toggle
          label="ALCANCE REAL"
          value={opts.advancedActualRange}
          onChange={v => update({ advancedActualRange: v })}
          desc="Comparar alcance actual (con avería) en vez de nominal"
        />

        <div style={{ height: 1, background: PD, marginBottom: 20, opacity: 0.3 }} />
        <div style={{ fontSize: 10, color: '#005522', letterSpacing: 3, marginBottom: 16, textTransform: 'uppercase' }}>
          Tablero
        </div>
        <Toggle
          label="ISLAS ALEATORIAS"
          value={opts.randomIslands}
          onChange={v => update({ randomIslands: v })}
          desc="Genera islas simétricas aleatoriamente al inicio"
        />

        <div style={{ height: 1, background: PD, marginBottom: 20, opacity: 0.3 }} />
        <div style={{ fontSize: 10, color: '#005522', letterSpacing: 3, marginBottom: 16, textTransform: 'uppercase' }}>
          Seguridad
        </div>
        <Toggle
          label="PIN TRASPASO"
          value={opts.presentation.handoffPin}
          onChange={v => update({ presentation: { ...opts.presentation, handoffPin: v } })}
          desc="Requiere PIN para confirmar cambio de turno (anti-espía)"
        />

        <div style={{ height: 1, background: PD, marginBottom: 24, opacity: 0.5 }} />

        {/* Nueva partida */}
        <button
          onClick={() => { resetGame(opts); setOpen(false); }}
          style={{
            width: '100%',
            padding: '10px',
            border: `1px solid ${P}`,
            borderRadius: 4,
            background: 'transparent',
            color: P,
            cursor: 'pointer',
            fontSize: 12,
            letterSpacing: 2,
            textTransform: 'uppercase',
            boxShadow: `0 0 8px rgba(0,255,100,0.2)`,
            transition: 'all 0.15s',
            marginBottom: 10,
          }}
          onMouseEnter={e => e.currentTarget.style.background = PD}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          ↺ NUEVA PARTIDA
        </button>

        {/* Version */}
        <div style={{ fontSize: 9, color: '#003311', textAlign: 'center', marginTop: 24, letterSpacing: 2 }}>
          AJEDREZ NAVAL v1.0<br />
          SYS:ONLINE — RADAR:ACTIVO
        </div>
      </div>
    </>
  );
};
