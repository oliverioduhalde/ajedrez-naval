import React, { useMemo } from 'react';
import { fxDelayMs, useFxStore } from '../../fx/fxStore';

/**
 * Marco del tablero: tiembla un instante cuando estalla una explosión grande (mina o hundimiento).
 * Dos nombres de animación alternados permiten reiniciarla si hay dos explosiones seguidas.
 */
export const ShakeFrame: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => {
  const big = useFxStore(s => s.effects.find(e => e.spec.type === 'explosion' && e.spec.size === 'large'));
  const delay = useMemo(() => (big ? fxDelayMs(big) : 0), [big]);
  const name = big && big.id % 2 ? 'fx-shake-a' : 'fx-shake-b';
  return (
    <div
      className="fx-shake"
      style={{ ...style, animation: big ? `${name} 340ms linear ${Math.round(delay)}ms both` : undefined }}
    >
      {children}
    </div>
  );
};
