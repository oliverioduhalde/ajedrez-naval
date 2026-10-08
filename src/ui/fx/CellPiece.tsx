import React, { useEffect, useState } from 'react';
import type { Piece, Player } from '../../engine/types';
import { fxDelayMs, useFxStore } from '../../fx/fxStore';
import type { Cell } from '../../fx/types';
import { PieceToken } from '../components/PieceToken';
import { DamagedFlames } from './DamagedFlames';

/**
 * Verdadero mientras el proyectil que averió esta ficha todavía no la alcanzó: hay una explosión
 * programada en su celda que no empezó. El estado ya la marca averiada, pero se la muestra ilesa
 * hasta el impacto (si no, un torpedo que tarda dos segundos la prendería fuego antes de llegar).
 */
function useImpactHold(pos: Cell | null, damaged: boolean): boolean {
  const fx = useFxStore(s => {
    if (!damaged || !pos) return undefined;
    return s.effects.find(e => e.spec.type === 'explosion' && e.spec.cell.r === pos.r && e.spec.cell.c === pos.c);
  });
  const [released, setReleased] = useState(0);

  useEffect(() => {
    if (!fx) return;
    const wait = fxDelayMs(fx);
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setReleased(fx.id), wait);
    return () => window.clearTimeout(timer);
  }, [fx]);

  return fx !== undefined && released !== fx.id && fxDelayMs(fx) > 0;
}

interface Props {
  piece: Piece;
  viewAs: Player;
  selected: boolean;
  enlarge: boolean;
  targetable: boolean;
  cellSize: number;
}

/** La ficha de una celda del tablero con sus llamas si está averiada. `cellSize` es el lado útil de la ficha. */
export const CellPiece: React.FC<Props> = ({ piece, cellSize, ...tokenProps }) => {
  const held = useImpactHold(piece.pos, piece.damaged);
  const shown = held ? { ...piece, damaged: false } : piece;
  return (
    <div style={{ position: 'absolute', inset: 2 }}>
      <PieceToken piece={shown} cellSize={cellSize} {...tokenProps} />
      {shown.damaged && <DamagedFlames cellSize={cellSize} seed={piece.id} />}
    </div>
  );
};
