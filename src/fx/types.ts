import type { CombatResult, Player, UnitType } from '../engine/types';

export type Cell = { r: number; c: number };

/**
 * Sonidos sintetizados (Web Audio, sin archivos). Cada uno entra con fade in y sale con fade out.
 *  - sonar        ping de sonar del submarino (con eco)
 *  - shipMove     desplazamiento de un barco: motor grave + agua, dur variable
 *  - reconMove    avión de reconocimiento: doble hélice, grave, dur variable
 *  - fighterDive  caza de la 2ª guerra en picada: silbido ascendente de hélice, dur variable
 *  - cannon       cañonazo
 *  - torpedo      lanzamiento y recorrido del torpedo bajo el agua, dur variable
 *  - machineGun   ráfaga de ametralladora (metralla), dur variable
 *  - explosion    explosión (tamaño según gain)
 *  - splash       splash grande de agua
 *  - splashSmall  chapoteo pequeño (impacto sin daño)
 */
export type SoundId =
  | 'sonar'
  | 'shipMove'
  | 'reconMove'
  | 'fighterDive'
  | 'cannon'
  | 'torpedo'
  | 'machineGun'
  | 'explosion'
  | 'splash'
  | 'splashSmall';

export interface SoundCue {
  /** ms desde el inicio de la acción */
  at: number;
  id: SoundId;
  /** duración total en ms para los sonidos de largo variable (el motor aplica fade in/out dentro de ella) */
  dur?: number;
  /** volumen relativo 0..1.5 (1 = nominal) */
  gain?: number;
}

/**
 * Efectos visuales sobre el tablero. Todas las celdas están en coordenadas del motor (r,c);
 * la capa los dibuja rotados según la vista. `at` y `dur` en ms desde el inicio de la acción.
 */
export type FxSpec =
  /** Fogonazo + humo en la boca del arma. `dir` apunta hacia el blanco, en celdas del motor. */
  | { type: 'muzzle'; at: number; dur: number; cell: Cell; toward: Cell; weapon: 'cannon' | 'gun' }
  /** Proyectil de cañón: punto brillante con estela entre dos celdas. */
  | { type: 'shell'; at: number; dur: number; from: Cell; to: Cell }
  /** Torpedo con estela de burbujas. */
  | { type: 'torpedo'; at: number; dur: number; from: Cell; to: Cell }
  /** Ráfaga de trazadoras (metralla) entre dos celdas. */
  | { type: 'tracers'; at: number; dur: number; from: Cell; to: Cell }
  /** Explosión con bola de fuego, onda expansiva y chispas. */
  | { type: 'explosion'; at: number; dur: number; cell: Cell; size: 'small' | 'medium' | 'large' }
  /** Splash de agua (columna + anillos). `big` para minas. */
  | { type: 'splash'; at: number; dur: number; cell: Cell; size: 'small' | 'big' }
  /** Chispas / impactos de bala sobre un blanco que no recibe daño. */
  | { type: 'sparks'; at: number; dur: number; cell: Cell }
  /**
   * Fantasma de una ficha que el estado ya quitó del tablero (hundida/derribada): se dibuja
   * en su celda hasta `at + dur` para que no desaparezca antes de que llegue el proyectil.
   */
  | { type: 'ghost'; at: number; dur: number; cell: Cell; unit: UnitType; owner: Player; damaged: boolean };

export interface Choreography {
  sounds: SoundCue[];
  visuals: FxSpec[];
  /** ms hasta que termina todo (último sonido/efecto) */
  total: number;
}

/** Lo que ocurre en la partida, emitido por el store tras cada acción válida. */
export type FxEvent =
  | {
      kind: 'move';
      pieceId: string;
      unit: UnitType;
      owner: Player;
      from: Cell;
      /** casillas recorridas en orden (sin el origen) */
      path: Cell[];
      /** false si el espectador no puede ver la identidad de la ficha: no se sonoriza (niebla de guerra) */
      audible: boolean;
      /** la ficha muere en una mina al final del recorrido: el sonido se corta antes */
      endsInBlast?: boolean;
    }
  | {
      kind: 'attack';
      attackerId: string;
      attackerUnit: UnitType;
      attackerOwner: Player;
      from: Cell;
      targetId: string;
      targetUnit: UnitType;
      targetOwner: Player;
      to: Cell;
      /** distancia en casillas (>= 1) */
      distance: number;
      result: CombatResult;
      targetWasDamaged: boolean;
    }
  | {
      kind: 'mineBlast';
      pieceId: string;
      unit: UnitType;
      owner: Player;
      at: Cell;
      damaged: boolean;
    };
