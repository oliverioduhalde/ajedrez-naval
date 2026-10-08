import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CPU_AVAILABLE, useSettings, ZOOM_MAX, ZOOM_MIN } from '../../store/settingsStore';
import { CPU_LEVELS } from '../../ai/types';
import { PALETTES, paletteSwatch, resolveBoard, resolveRival, type PaletteId } from '../theme';
import { mix } from '../ui';

const Toggle: React.FC<{
  label: string; value: boolean; onChange: (v: boolean) => void; desc?: string;
}> = ({ label, value, onChange, desc }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
      <span style={{ color: value ? 'var(--main)' : 'var(--main-soft)', fontSize: 14 }}>{label}</span>
      <button
        onClick={() => onChange(!value)}
        aria-pressed={value}
        style={{
          width: 44, height: 24, minWidth: 44, minHeight: 24, borderRadius: 12, cursor: 'pointer', position: 'relative',
          border: `1px solid ${value ? 'var(--main)' : 'var(--line)'}`,
          background: value ? mix('var(--main)', 30) : 'var(--panel)',
          transition: 'background 0.15s',
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: value ? 22 : 3, width: 16, height: 16, borderRadius: '50%',
          background: value ? 'var(--main)' : 'var(--main-mute)', transition: 'left 0.15s',
        }} />
      </button>
    </div>
    {desc && <div style={{ fontSize: 12, color: 'var(--main-mute)', marginTop: 4, lineHeight: 1.4 }}>{desc}</div>}
  </div>
);

const Section: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontSize: 11, color: 'var(--main-soft)', letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: 700,
    margin: '8px 0 14px', paddingTop: 14, borderTop: '1px solid var(--line)',
  }}>
    {children}
  </div>
);

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}> = ({ label, value, min, max, step, format, onChange, disabled }) => (
  <div style={{ marginBottom: 16, opacity: disabled ? 0.4 : 1 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--main-soft)' }}>
      <span>{label}</span>
      <span style={{ color: 'var(--main)' }}>{format(value)}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%', marginTop: 6, cursor: disabled ? 'not-allowed' : 'pointer' }}
    />
  </div>
);

const Seg: React.FC<{
  options: { value: string; label: string }[]; value: string; onChange: (v: string) => void;
}> = ({ options, value, onChange }) => (
  <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden', marginBottom: 14 }}>
    {options.map((o, i) => (
      <button
        key={o.value}
        onClick={() => onChange(o.value)}
        style={{
          flex: 1, padding: '8px 0', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          background: o.value === value ? mix('var(--main)', 20) : 'transparent',
          color: o.value === value ? 'var(--main)' : 'var(--main-soft)',
          border: 'none', borderLeft: i === 0 ? 'none' : '1px solid var(--line)',
        }}
      >
        {o.label}
      </button>
    ))}
  </div>
);

const MiniBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      flex: 1, padding: '7px 0', background: 'transparent', cursor: 'pointer', borderRadius: 4,
      border: '1px solid var(--line)', color: 'var(--main-soft)', fontSize: 12, fontWeight: 600,
    }}
  >
    {label}
  </button>
);

const Swatches: React.FC<{
  value: string; onPick: (id: PaletteId) => void; disabledIds?: PaletteId[]; extra?: React.ReactNode;
}> = ({ value, onPick, disabledIds = [], extra }) => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
    {extra}
    {PALETTES.map(p => {
      const selected = value === p.id;
      const disabled = disabledIds.includes(p.id);
      return (
        <button
          key={p.id}
          onClick={() => !disabled && onPick(p.id)}
          disabled={disabled}
          title={p.name}
          aria-label={p.name}
          style={{
            width: 30, height: 30, minWidth: 30, minHeight: 30, borderRadius: '50%', cursor: disabled ? 'not-allowed' : 'pointer',
            background: paletteSwatch(p.id), opacity: disabled ? 0.25 : 1,
            border: selected ? '3px solid var(--text)' : '2px solid var(--line)',
            boxShadow: selected ? `0 0 0 2px ${mix('var(--text)', 30)}` : 'none',
          }}
        />
      );
    })}
  </div>
);

export const HamburgerMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { game, resetGame } = useGameStore();
  const opts = game.options;
  const st = useSettings();
  const rivalId = resolveRival(st.colorMain, st.colorRival);
  const boardId = resolveBoard(st.colorMain, rivalId, st.colorBoard);

  function update(patch: Partial<typeof opts>) {
    resetGame({ ...opts, ...patch });
  }

  const bar: React.CSSProperties = { width: 18, height: 2, background: 'var(--main)', borderRadius: 1 };

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="Ajustes"
        aria-label="Ajustes"
        style={{
          width: 36, height: 36, minWidth: 36, minHeight: 36, borderRadius: 6, cursor: 'pointer', flexShrink: 0,
          border: `1px solid ${open ? 'var(--main)' : 'var(--line)'}`, background: open ? mix('var(--main)', 12) : 'transparent',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}
      >
        <div style={{ ...bar, transform: open ? 'translateY(6px) rotate(45deg)' : 'none', transition: 'transform 0.2s' }} />
        <div style={{ ...bar, opacity: open ? 0 : 1, transition: 'opacity 0.2s' }} />
        <div style={{ ...bar, transform: open ? 'translateY(-6px) rotate(-45deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)' }} />
      )}

      <div style={{
        position: 'fixed', top: 0, right: 0, height: '100dvh', width: 'min(340px, 92vw)',
        background: 'var(--bg)', borderLeft: '1px solid var(--line)', zIndex: 10001,
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        padding: '18px 22px 28px', overflowY: 'auto',
        visibility: open ? 'visible' : 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--main)' }}>Ajustes</div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Cerrar ajustes"
            style={{ background: 'none', border: 'none', color: 'var(--main-soft)', fontSize: 22, cursor: 'pointer' }}
          >×</button>
        </div>

        {CPU_AVAILABLE && (
          <>
            <Section>Partida</Section>
            <Seg
              value={st.vsCpu ? 'cpu' : '2p'}
              options={[{ value: '2p', label: '2 jugadores' }, { value: 'cpu', label: '1 contra la CPU' }]}
              onChange={v => { st.set({ vsCpu: v === 'cpu' }); resetGame(opts); }}
            />
            {st.vsCpu && (
              <>
                <div style={{ fontSize: 14, color: 'var(--main-soft)', marginBottom: 6 }}>Nivel de la CPU</div>
                <Seg
                  value={String(st.cpuLevel)}
                  options={CPU_LEVELS.map(l => ({ value: String(l.level), label: String(l.level) }))}
                  onChange={v => st.set({ cpuLevel: Number(v) as 1 | 2 | 3 | 4 | 5 })}
                />
                <div style={{ fontSize: 13, color: 'var(--main)', marginTop: -6 }}>{CPU_LEVELS[st.cpuLevel - 1].name}</div>
                <div style={{ fontSize: 12, color: 'var(--main-mute)', marginBottom: 16, lineHeight: 1.4 }}>
                  {CPU_LEVELS[st.cpuLevel - 1].blurb}. Vos jugás como J.A y la CPU como J.B. Cambiar de modo empieza una partida nueva.
                </div>
              </>
            )}
          </>
        )}

        <Section>Colores</Section>
        <div style={{ fontSize: 14, color: 'var(--main-soft)', marginBottom: 8 }}>Color general (y jugador A)</div>
        <Swatches value={st.colorMain} onPick={id => st.set({ colorMain: id })} />
        <div style={{ fontSize: 14, color: 'var(--main-soft)', marginBottom: 8 }}>Color del rival (jugador B)</div>
        <Swatches
          value={st.colorRival === 'auto' ? rivalId : st.colorRival}
          disabledIds={[st.colorMain]}
          onPick={id => st.set({ colorRival: id })}
          extra={
            <button
              onClick={() => st.set({ colorRival: 'auto' })}
              style={{
                padding: '0 10px', height: 30, borderRadius: 15, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: st.colorRival === 'auto' ? mix('var(--main)', 20) : 'transparent',
                color: st.colorRival === 'auto' ? 'var(--main)' : 'var(--main-soft)',
                border: `1px solid ${st.colorRival === 'auto' ? 'var(--main)' : 'var(--line)'}`,
              }}
            >
              Auto
            </button>
          }
        />
        <div style={{ fontSize: 12, color: 'var(--main-mute)', marginBottom: 16, lineHeight: 1.4 }}>
          El rival siempre usa un color distinto al general. En Auto se elige el contraste: verde con ámbar, por ejemplo.
        </div>
        <div style={{ fontSize: 14, color: 'var(--main-soft)', marginBottom: 8 }}>Color del tablero</div>
        <Swatches
          value={boardId}
          disabledIds={[st.colorMain, rivalId]}
          onPick={id => st.set({ colorBoard: id })}
        />
        <div style={{ fontSize: 12, color: 'var(--main-mute)', marginBottom: 16, lineHeight: 1.4 }}>
          El tablero (mar, islas, grilla y radar) tiene un tercer color, distinto al de las fichas de los dos jugadores. Por defecto, azul mar.
        </div>

        <Section>Radar</Section>
        <Toggle label="Radar" value={st.radarOn} onChange={v => st.set({ radarOn: v })} desc="Barrido giratorio sobre el tablero." />
        <Slider label="Velocidad" value={st.radarSpeed} min={0.2} max={5} step={0.1} disabled={!st.radarOn}
          format={v => v.toFixed(1) + 'x'} onChange={v => st.set({ radarSpeed: v })} />
        <Slider label="Intensidad" value={st.radarIntensity} min={0.2} max={2} step={0.1} disabled={!st.radarOn}
          format={v => Math.round(v * 100) + '%'} onChange={v => st.set({ radarIntensity: v })} />

        <Section>Tablero</Section>
        <Slider label="Zoom" value={st.zoom} min={ZOOM_MIN} max={ZOOM_MAX} step={0.05}
          format={v => Math.round(v * 100) + '%'} onChange={v => st.set({ zoom: v })} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <MiniBtn label="−" onClick={() => st.zoomBy(1 / 1.2)} />
          <MiniBtn label="Ajustar" onClick={st.resetZoom} />
          <MiniBtn label="+" onClick={() => st.zoomBy(1.2)} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--main-mute)', marginBottom: 16, lineHeight: 1.4 }}>
          100% ocupa el máximo de pantalla; más grande activa el scroll. También podés usar Ctrl + rueda o pellizcar con dos dedos.
        </div>
        <div style={{ fontSize: 14, color: 'var(--main-soft)', marginBottom: 6 }}>Rotación</div>
        <Seg
          value={String(st.rotation)}
          options={[{ value: 'auto', label: 'Auto' }, { value: '0', label: '0°' }, { value: '90', label: '90°' }, { value: '180', label: '180°' }, { value: '270', label: '270°' }]}
          onChange={v => st.set({ rotation: v === 'auto' ? 'auto' : (Number(v) as 0 | 90 | 180 | 270) })}
        />
        <div style={{ fontSize: 12, color: 'var(--main-mute)', marginBottom: 16, lineHeight: 1.4 }}>
          Auto gira el tablero cuando la pantalla es vertical para aprovechar más espacio.
        </div>
        <Toggle label="Panel lateral visible" value={!st.railCollapsed} onChange={v => st.set({ railCollapsed: !v })}
          desc="Ocultalo para dar todo el ancho al tablero." />

        <Section>Fichas</Section>
        <Toggle label="Ampliar ficha con doble clic" value={st.pieceZoomOn} onChange={v => st.set({ pieceZoomOn: v })}
          desc="Doble clic (o doble toque) abre la ficha ampliada en el centro. Un clic fuera la cierra." />
        <Slider label="Tamaño de la ficha ampliada" value={st.pieceZoomSize} min={160} max={560} step={20} disabled={!st.pieceZoomOn}
          format={v => v + ' px'} onChange={v => st.set({ pieceZoomSize: v })} />
        <Toggle label="Mostrar alcances al tocar" value={st.showRanges} onChange={v => st.set({ showRanges: v })}
          desc="Un clic en una ficha marca su alcance de movimiento y de tiro." />

        <Section>Efectos de pantalla (opcionales)</Section>
        <Toggle label="Efecto CRT" value={st.crtOn} onChange={v => st.set({ crtOn: v })} desc="Líneas de barrido y viñeta, como un monitor antiguo." />
        <Toggle label="Glitches" value={st.glitchOn} onChange={v => st.set({ glitchOn: v })} desc="Cortes horizontales y aberración de color." />
        <Slider label="Frecuencia de glitches" value={st.glitchRate} min={0.3} max={4} step={0.1} disabled={!st.glitchOn}
          format={v => v.toFixed(1) + 'x'} onChange={v => st.set({ glitchRate: v })} />
        <Toggle label="Parpadeo" value={st.flickerOn} onChange={v => st.set({ flickerOn: v })} desc="Variación de brillo de la pantalla." />

        <Section>Reglas de la partida</Section>
        <Toggle label="Dados" value={opts.useDice} onChange={v => update({ useDice: v })}
          desc="Variante: el movimiento se determina con dados en vez de fichas de número." />
        <Toggle label="Alcance real" value={opts.advancedActualRange} onChange={v => update({ advancedActualRange: v })}
          desc="Comparar el alcance actual (con avería) en vez del nominal." />
        <Toggle label="Islas aleatorias" value={opts.randomIslands} onChange={v => update({ randomIslands: v })}
          desc="Genera islas simétricas al azar al inicio." />
        <Toggle label="PIN de traspaso" value={opts.presentation.handoffPin}
          onChange={v => update({ presentation: { ...opts.presentation, handoffPin: v } })}
          desc="Pide un PIN para confirmar el cambio de turno (para que el rival no espíe)." />
        <div style={{ fontSize: 12, color: 'var(--main-mute)', marginBottom: 14, lineHeight: 1.4 }}>
          Cambiar una regla empieza una partida nueva.
        </div>

        <button
          onClick={() => { resetGame(opts); setOpen(false); }}
          style={{
            width: '100%', padding: '12px', borderRadius: 4, cursor: 'pointer', marginTop: 4,
            border: '1px solid var(--main)', background: mix('var(--main)', 14), color: 'var(--main)',
            fontSize: 14, fontWeight: 700,
          }}
        >
          Nueva partida
        </button>
      </div>
    </>
  );
};
