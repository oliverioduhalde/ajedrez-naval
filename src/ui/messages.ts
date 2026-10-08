import type { UnitType } from '../engine/types';

const ES: Record<string, string> = {
  'Not in setup phase': 'Ahora no es la fase de despliegue.',
  'Piece not found': 'No se encontró la pieza.',
  'Not your piece': 'Esa pieza no es tuya.',
  'Invalid setup position': 'Posición inválida: desplegá solo dentro de tu zona de salida.',
  'Cell already occupied': 'Esa casilla ya está ocupada.',
  'All pieces must be placed': 'Tenés que desplegar las 16 piezas antes de continuar.',
  'Not in play phase': 'Ahora no es la fase de juego.',
  'Token not available': 'Esa ficha no está disponible.',
  'Token already selected': 'Ya elegiste una ficha en este turno.',
  'Select a number token first': 'Elegí primero una ficha de número.',
  'Piece is destroyed': 'La pieza está destruida.',
  'Must move one cell at a time (call movePiece per step)': 'Solo podés moverte de a una casilla, en línea recta.',
  'Not enough movement budget': 'No te alcanza el movimiento restante.',
  'Already attacked or reconned this turn': 'Ya atacaste o reconociste en este turno.',
  "Can't attack your own piece": 'No podés atacar una pieza propia.',
  'Piece not on board': 'La pieza no está en el tablero.',
  'AvionCombate must attack before moving': 'El avión de combate debe atacar antes de moverse.',
  'Combat plane already attacked this turn': 'Este avión de combate ya atacó en este turno.',
  'AvionReconocimiento cannot attack': 'El avión de reconocimiento no ataca: solo reconoce.',
  'Attack must be in a straight orthogonal line': 'El ataque debe ser en línea recta (fila o columna).',
  'Target out of range': 'El objetivo está fuera de alcance.',
  'Line of sight blocked': 'Línea de visión bloqueada.',
  'Only AvionReconocimiento can recon': 'Solo el avión de reconocimiento puede reconocer.',
  "Can't recon your own piece": 'No podés reconocer una pieza propia.',
  'Only Minadores can place mines': 'Solo los minadores pueden colocar minas.',
  'Minador not on board': 'El minador no está en el tablero.',
  'No mines left': 'No te quedan minas.',
  'Mine already at that cell': 'Ya hay una mina en esa casilla.',
  'Only Minadores can lift mines': 'Solo los minadores pueden levantar minas.',
  'No mine at that position': 'No hay una mina en esa casilla.',
  'No token selected': 'Elegí una ficha antes de terminar el turno.',
};

export function esError(msg: string): string {
  return ES[msg] ?? 'Acción no permitida.';
}

export const PIECE_NAMES: Record<UnitType, string> = {
  Acorazado: 'Acorazado',
  Crucero: 'Crucero',
  Fragata: 'Fragata',
  Minador: 'Minador',
  Submarino: 'Submarino',
  AvionCombate: 'Avión de combate',
  AvionReconocimiento: 'Avión de reconocimiento',
};

export const PIECE_ROLE: Record<UnitType, string> = {
  Acorazado: 'Barco pesado. Hunde barcos de alcance igual o menor y avería a los de mayor alcance. Solo derriba aviones a 1 casilla. No daña submarinos.',
  Crucero: 'Barco de línea. Hunde barcos de alcance igual o menor y avería a los de mayor alcance. Solo derriba aviones a 1 casilla. No daña submarinos.',
  Fragata: 'Único barco que hunde submarinos y es inmune a su ataque. Solo derriba aviones a 1 casilla.',
  Minador: 'Coloca y levanta minas. Cruza campos minados sin riesgo. Alcance corto.',
  Submarino: 'Hunde barcos (menos fragatas) y derriba aviones. Solo las fragatas lo hunden.',
  AvionCombate: 'Ataca antes de moverse. Hunde submarinos y derriba aviones; no daña barcos. Cruza campos minados.',
  AvionReconocimiento: 'No ataca: reconoce piezas rivales en su línea de visión para revelar su identidad. Cruza campos minados.',
};
