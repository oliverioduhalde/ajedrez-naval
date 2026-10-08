import type { GameState, Player } from '../engine/types';
import type { CpuAction, CpuLevel, Placement } from './types';
import { chooseAction, chooseSetup } from './index';
import { setSearchMemory } from './levels/level45';
import { mulberry32 } from './rng';

export interface WorkerRequest {
  id: number;
  kind: 'action' | 'setup';
  state: GameState;
  me: Player;
  level: CpuLevel;
  /** Semilla del rng; sin ella el nivel deriva una de la vista (determinista). */
  seed?: number;
  iterations?: number;
  timeBudgetMs?: number;
}

export type WorkerResponse =
  | { id: number; result: CpuAction | Placement[]; error?: undefined }
  | { id: number; error: string; result?: undefined };

/** Resuelve una peticion sin lanzar: ante un fallo devuelve { id, error } para que el cliente caiga al hilo principal. */
export function handleRequest(req: WorkerRequest): WorkerResponse {
  try {
    const opts = {
      rng: req.seed === undefined ? undefined : mulberry32(req.seed),
      iterations: req.iterations,
      timeBudgetMs: req.timeBudgetMs,
    };
    const result =
      req.kind === 'action'
        ? chooseAction(req.state, req.me, req.level, opts)
        : chooseSetup(req.state, req.me, req.level, opts);
    return { id: req.id, result };
  } catch (e) {
    return { id: req.id, error: e instanceof Error ? e.message : String(e) };
  }
}

interface WorkerScope {
  postMessage(msg: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}

// Solo se registra dentro de un Worker: en el hilo principal (o en tests) importar este modulo no hace nada.
// El worker vive toda la partida, asi que es el unico sitio donde se enciende la memoria de busqueda
// (el nivel 5 reutiliza su arbol entre las acciones de un mismo turno).
if (typeof window === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  const scope = self as unknown as WorkerScope;
  setSearchMemory(true);
  scope.onmessage = e => scope.postMessage(handleRequest(e.data));
}
