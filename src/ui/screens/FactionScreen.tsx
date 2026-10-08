import React from 'react';
import { useSettings } from '../../store/settingsStore';
import { useFactionStore } from '../../store/factionStore';
import { FACTIONS, factionOf, otherFaction, type FactionDef, type FactionId } from '../../config/factions';
import { playAnthem, stopAnthem, unlockAnthemAudio } from '../../fx/anthems/player';
import { Btn, Card, Label, mix } from '../ui';

const FactionCard: React.FC<{
  f: FactionDef; selected: boolean; disabled: boolean; onPick: () => void;
}> = ({ f, selected, disabled, onPick }) => (
  <div
    role="radio"
    aria-checked={selected}
    aria-disabled={disabled}
    tabIndex={disabled ? -1 : 0}
    onClick={() => !disabled && onPick()}
    onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(); } }}
    style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 6, minWidth: 0,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1,
      border: `${selected ? 2 : 1}px solid ${selected ? f.tones.main : 'var(--line)'}`,
      background: selected ? mix(f.tones.main, 12) : 'transparent',
      boxShadow: selected ? `0 0 0 2px ${mix(f.tones.main, 30)}` : 'none',
    }}
  >
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span style={{
        width: 52, height: 34, borderRadius: 3, flexShrink: 0, background: f.flag,
        border: `1px solid ${f.edge}`,
      }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: selected ? f.tones.main : 'var(--text)' }}>{f.name}</div>
        <div style={{ fontSize: 11, color: 'var(--main-mute)', lineHeight: 1.25 }}>{f.era}</div>
      </div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
      <span style={{ fontSize: 11, color: 'var(--main-soft)', lineHeight: 1.25 }}>♪ {f.anthem}</span>
      <button
        type="button"
        aria-label={`Escuchar el himno de ${f.name}`}
        title="Escuchar el himno"
        onClick={e => { e.stopPropagation(); unlockAnthemAudio(); playAnthem(f.id); }}
        style={{
          flexShrink: 0, width: 32, height: 28, borderRadius: 4, cursor: 'pointer', fontSize: 12,
          border: '1px solid var(--line)', background: 'transparent', color: 'var(--main-soft)',
        }}
      >▶</button>
    </div>
  </div>
);

const Row: React.FC<{
  title: string; value: FactionId; blocked: FactionId; onPick: (id: FactionId) => void;
}> = ({ title, value, blocked, onPick }) => {
  const f = factionOf(value);
  return (
    <Card style={{ borderColor: mix(f.tones.main, 40) }}>
      <Label>{title}</Label>
      <div role="radiogroup" aria-label={title} style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8, marginTop: 8,
      }}>
        {FACTIONS.map(x => (
          <FactionCard key={x.id} f={x} selected={x.id === value} disabled={x.id === blocked} onPick={() => onPick(x.id)} />
        ))}
      </div>
    </Card>
  );
};

/** Primera pantalla de cada partida: cada bando elige su facción (color de las fichas e himno). */
export const FactionScreen: React.FC = () => {
  const factionA = useSettings(s => s.factionA);
  const factionB = useSettings(s => s.factionB);
  const vsCpu = useSettings(s => s.vsCpu);
  const set = useSettings(s => s.set);
  const confirm = useFactionStore(s => s.confirm);

  const pickA = (id: FactionId) => set({ factionA: id, factionB: otherFaction(id, factionB) });
  const pickB = (id: FactionId) => set({ factionB: id, factionA: otherFaction(id, factionA) });
  const pickRandom = () => {
    const ids = FACTIONS.map(f => f.id);
    const a = ids[Math.floor(Math.random() * ids.length)];
    const rest = ids.filter(i => i !== a);
    set({ factionA: a, factionB: rest[Math.floor(Math.random() * rest.length)] });
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', display: 'flex', justifyContent: 'center', padding: '8px 4px 24px' }}>
      <div style={{ width: 'min(880px, 100%)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ textAlign: 'center', padding: '10px 0 2px' }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: 'var(--main-mute)', textTransform: 'uppercase' }}>Ajedrez naval</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--main)', marginTop: 2 }}>Elegí tu facción</div>
          <div style={{ fontSize: 13, color: 'var(--main-soft)', marginTop: 4, lineHeight: 1.4 }}>
            Define el color de tus fichas. Si ganás, suena la parte más famosa del himno de tu país.
          </div>
        </div>

        <Row title="Jugador A" value={factionA} blocked={factionB} onPick={pickA} />
        <Row title={vsCpu ? 'CPU (jugador B)' : 'Jugador B'} value={factionB} blocked={factionA} onPick={pickB} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn onClick={pickRandom} style={{ width: 'auto', textAlign: 'center', padding: '11px 18px' }}>Al azar</Btn>
          <button
            type="button"
            onClick={() => { stopAnthem(); unlockAnthemAudio(); confirm(); }}
            style={{
              flex: 1, minWidth: 180, padding: '12px', borderRadius: 4, cursor: 'pointer', fontSize: 15, fontWeight: 800,
              border: '1px solid var(--main)', background: mix('var(--main)', 16), color: 'var(--main)',
            }}
          >
            Empezar: {factionOf(factionA).name} contra {factionOf(factionB).name}
          </button>
        </div>
      </div>
    </div>
  );
};
