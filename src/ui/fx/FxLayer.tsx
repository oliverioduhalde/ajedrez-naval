import React, { useState } from 'react';
import type { Piece } from '../../engine/types';
import { fxDelayMs, useFxStore, type ActiveFx } from '../../fx/fxStore';
import type { FxSpec } from '../../fx/types';
import type { Rot } from '../boardRotation';
import { PieceToken } from '../components/PieceToken';
import { DamagedFlames } from './DamagedFlames';
import { anim, cellOrigin } from './geometry';
import { Explosion, Splash, Sparks } from './impacts';
import { Muzzle, Shell, Torpedo, Tracers } from './projectiles';

/** Capas de abajo hacia arriba. El orden del DOM es fijo: reubicar un nodo reinicia su animación CSS. */
const LAYERS: FxSpec['type'][][] = [
  ['ghost'],
  ['splash'],
  ['torpedo'],
  ['explosion', 'sparks'],
  ['shell', 'tracers', 'muzzle'],
];

const GHOST_TREMBLE_MS = 150;

type GhostSpec = Extract<FxSpec, { type: 'ghost' }>;

/** La ficha que el estado ya quitó, dibujada en su celda hasta que llega el proyectil. */
const Ghost: React.FC<{ spec: GhostSpec; delay: number; cs: number; rot: Rot }> = ({ spec, delay, cs, rot }) => {
  const { x, y } = cellOrigin(rot, spec.cell, cs);
  const piece: Piece = {
    id: 'fx-ghost', owner: spec.owner, type: spec.unit, pos: null,
    damaged: spec.damaged, revealedTo: ['A', 'B'],
  };
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: cs, height: cs }}>
      <div style={{ position: 'absolute', inset: 2, animation: anim('fx-ghost-life', spec.dur, delay, { ease: 'linear' }) }}>
        <div style={{ width: '100%', height: '100%', animation: anim('fx-ghost-end', GHOST_TREMBLE_MS, delay + spec.dur - GHOST_TREMBLE_MS, { ease: 'linear' }) }}>
          <PieceToken piece={piece} viewAs={spec.owner} cellSize={cs - 4} />
          {spec.damaged && <DamagedFlames cellSize={cs - 4} seed="fx-ghost" instant />}
        </div>
      </div>
    </div>
  );
};

interface ItemProps { fx: ActiveFx; cs: number; rot: Rot }

/** Un efecto en curso. El retardo se calcula una sola vez al montar: cambiarlo con la animación corriendo la desfasaría. */
const FxItem = React.memo(function FxItem({ fx, cs, rot }: ItemProps) {
  const [delay] = useState(() => fxDelayMs(fx));
  const common = { seed: fx.id, delay, cs, rot };
  const spec = fx.spec;
  switch (spec.type) {
    case 'muzzle':    return <Muzzle spec={spec} {...common} />;
    case 'shell':     return <Shell spec={spec} {...common} />;
    case 'torpedo':   return <Torpedo spec={spec} {...common} />;
    case 'tracers':   return <Tracers spec={spec} {...common} />;
    case 'explosion': return <Explosion spec={spec} {...common} />;
    case 'splash':    return <Splash spec={spec} {...common} />;
    case 'sparks':    return <Sparks spec={spec} {...common} />;
    case 'ghost':     return <Ghost spec={spec} delay={delay} cs={cs} rot={rot} />;
  }
});

interface Props { cellSize: number; rot: Rot }

/**
 * Capa de efectos sobre el tablero: disparos, explosiones, splash y fichas fantasma.
 * Va por encima de las fichas (z 1) y debajo del menú flotante de la ficha (z 8).
 */
export const FxLayer: React.FC<Props> = ({ cellSize, rot }) => {
  const effects = useFxStore(s => s.effects);
  if (effects.length === 0) return null;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 5 }}>
      {LAYERS.map((types, i) => (
        <React.Fragment key={i}>
          {effects.filter(e => types.includes(e.spec.type)).map(fx => (
            <FxItem key={fx.id} fx={fx} cs={cellSize} rot={rot} />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};
