import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useSettings, ZOOM_MAX, ZOOM_MIN } from '../../store/settingsStore';

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


const Section: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <>
    <div style={{ height: 1, background: PD, marginBottom: 20, opacity: 0.3 }} />
    <div style={{ fontSize: 10, color: '#005522', letterSpacing: 3, marginBottom: 16, textTransform: 'uppercase' }}>
      {children}
    </div>
  </>
);

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}> = ({ label, value, min, max, step, format, onChange, disabled }) => (
  <div style={{ marginBottom: 18, opacity: disabled ? 0.35 : 1 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, letterSpacing: 1, color: '#00aa44' }}>
      <span>{label}</span>
      <span style={{ color: P }}>{format(value)}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', marginTop: 6, accentColor: P, cursor: disabled ? 'not-allowed' : 'pointer' }}
    />
  </div>
);

const MiniBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1, padding: '6px 0', background: 'transparent', cursor: 'pointer',
      border: `1px solid ${PD}`, color: '#00cc44', fontSize: 11, letterSpacing: 1,
    }}
  >
    {label}
  </button>
);

const Seg: React.FC<{
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}> = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', border: `1px solid ${PD}`, marginBottom: 18 }}>
    {options.map((o, i) => (
      <button
        key={o.value}
        onClick={() => onChange(o.value)}
        style={{
          flex: 1, padding: '7px 0', cursor: 'pointer',
          background: o.value === value ? PD : 'transparent',
          color: o.value === value ? P : '#00aa44',
          border: 'none', borderLeft: i === 0 ? 'none' : `1px solid ${PD}`,
          fontSize: 11, letterSpacing: 1,
          textShadow: o.value === value ? `0 0 6px ${P}` : 'none',
        }}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const HamburgerMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { game, resetGame } = useGameStore();
  const opts = game.options;
  const st = useSettings();

  function update(patch: Partial<typeof opts>) {
    resetGame({ ...opts, ...patch });
  }

  const lines = { width: 22, height: 2, background: P, borderRadius: 1, boxShadow: `0 0 6px ${P}` };

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
        width: 'min(320px, 92vw)',
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

        <Section>Radar</Section>
        <Toggle label="RADAR" value={st.radarOn} onChange={v => st.set({ radarOn: v })} desc="Barrido giratorio sobre el tablero" />
        <Slider label="VELOCIDAD" value={st.radarSpeed} min={0.2} max={5} step={0.1} disabled={!st.radarOn}
          format={v => v.toFixed(1) + 'x'} onChange={v => st.set({ radarSpeed: v })} />
        <Slider label="INTENSIDAD" value={st.radarIntensity} min={0.2} max={2} step={0.1} disabled={!st.radarOn}
          format={v => Math.round(v * 100) + '%'} onChange={v => st.set({ radarIntensity: v })} />

        <Section>Pantalla CRT</Section>
        <Toggle label="GLITCHES" value={st.glitchOn} onChange={v => st.set({ glitchOn: v })} desc="Cortes horizontales y aberración de color" />
        <Slider label="FRECUENCIA" value={st.glitchRate} min={0.3} max={4} step={0.1} disabled={!st.glitchOn}
          format={v => v.toFixed(1) + 'x'} onChange={v => st.set({ glitchRate: v })} />
        <Toggle label="PARPADEO" value={st.flickerOn} onChange={v => st.set({ flickerOn: v })} desc="Variación de brillo del tubo" />

        <Section>Tablero</Section>
        <Slider label="ZOOM" value={st.zoom} min={ZOOM_MIN} max={ZOOM_MAX} step={0.05}
          format={v => Math.round(v * 100) + '%'} onChange={v => st.set({ zoom: v })} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <MiniBtn label="−" onClick={() => st.zoomBy(1 / 1.2)} />
          <MiniBtn label="AJUSTAR" onClick={st.resetZoom} />
          <MiniBtn label="+" onClick={() => st.zoomBy(1.2)} />
        </div>
        <div style={{ fontSize: 13, letterSpacing: 1, color: '#00aa44', marginBottom: 6 }}>ROTACIÓN</div>
        <Seg
          value={String(st.rotation)}
          options={[{ value: 'auto', label: 'AUTO' }, { value: '0', label: '0°' }, { value: '90', label: '90°' }, { value: '180', label: '180°' }, { value: '270', label: '270°' }]}
          onChange={v => st.set({ rotation: v === 'auto' ? 'auto' : (Number(v) as 0 | 90 | 180 | 270) })}
        />
        <div style={{ fontSize: 10, color: '#005522', marginBottom: 18, letterSpacing: 0.5 }}>
          100% ocupa el máximo de pantalla. Más grande activa el scroll. Ctrl + rueda o pellizco también hacen zoom. AUTO rota el tablero cuando la pantalla es vertical.
        </div>

        {/* Options */}
        <Section>Modo de turno</Section>
        <Toggle
          label="DADOS"
          value={opts.useDice}
          onChange={v => update({ useDice: v })}
          desc="Variante: el movimiento se determina con dados en vez de fichas-número"
        />

        <Section>Combate</Section>
        <Toggle
          label="ALCANCE REAL"
          value={opts.advancedActualRange}
          onChange={v => update({ advancedActualRange: v })}
          desc="Comparar alcance actual (con avería) en vez de nominal"
        />

        <Section>Mapa</Section>
        <Toggle
          label="ISLAS ALEATORIAS"
          value={opts.randomIslands}
          onChange={v => update({ randomIslands: v })}
          desc="Genera islas simétricas aleatoriamente al inicio"
        />

        <Section>Seguridad</Section>
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
