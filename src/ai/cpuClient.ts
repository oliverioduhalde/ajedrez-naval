import type { GameState, Player } from '../engine/types';
import type { CpuAction, CpuApi, CpuLevel, Placement } from './types';
import type { WorkerRequest, WorkerResponse } from './worker';
import { chooseAction, chooseSetup } from './index';
import { mulberry32 } from './rng';

type Request = Omit<WorkerRequest, 'id' | 'seed'>;

interface Pending {
  req: WorkerRequest;
  resolve: (r: CpuAction | Placement[]) => void;
  reject: (e: Error) => void;
  /** Vigilante: si el worker no responde a tiempo se lo abandona y se resuelve en el hilo principal. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Generacion de acciones al crearse: una peticion de accion mas nueva deja obsoleta a esta. */
  gen: number;
}

export interface CpuClientConfig {
  /** Se agregan a cada peticion que no traiga los suyos (util para tests y para ajustar la dificultad). */
  iterations?: number;
  timeBudgetMs?: number;
  /** Tiempo maximo de espera por una respuesta del worker antes de abandonarlo (default 30 s). */
  workerTimeoutMs?: number;
}

const config: CpuClientConfig = {};

/** Ajusta el cliente (globalmente). Pasar undefined en un campo lo devuelve al default. */
export function configureCpu(next: CpuClientConfig): void {
  Object.assign(config, next);
}

// Frontera con el exterior: aca (y solo aca) entra entropia para que las partidas varien.
function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
}

let worker: Worker | null | undefined;
let nextId = 1;
/** Se incrementa en cada cancelacion: lo que nacio en una epoca vieja no se ejecuta. */
let epoch = 0;
let actionGen = 0;
const pending = new Map<number, Pending>();

function runLocal(req: WorkerRequest): CpuAction | Placement[] {
  const opts = { rng: mulberry32(req.seed ?? freshSeed()), iterations: req.iterations, timeBudgetMs: req.timeBudgetMs };
  return req.kind === 'action'
    ? chooseAction(req.state, req.me, req.level, opts)
    : chooseSetup(req.state, req.me, req.level, opts);
}

function runLocalAsync(p: Pending): void {
  const born = epoch;
  setTimeout(() => {
    if (born !== epoch || (p.req.kind === 'action' && p.gen !== actionGen)) {
      p.reject(new Error('cancelado'));
      return;
    }
    try {
      p.resolve(runLocal(p.req));
    } catch (e) {
      p.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }, 0);
}

function settle(p: Pending): void {
  if (p.timer !== null) clearTimeout(p.timer);
  p.timer = null;
  pending.delete(p.req.id);
}

/** El worker fallo o se colgo: se lo termina y lo pendiente se resuelve en el hilo principal. */
function abandonWorker(): void {
  worker?.terminate();
  worker = null;
  const stuck = [...pending.values()];
  pending.clear();
  for (const p of stuck) {
    if (p.timer !== null) clearTimeout(p.timer);
    p.timer = null;
    runLocalAsync(p);
  }
}

function terminateWorker(): void {
  worker?.terminate();
  worker = undefined;
}

/**
 * Descarta todo lo pendiente (las promesas se rechazan con Error('cancelado')) y termina el worker,
 * lo que interrumpe un calculo en curso; se recrea al pedir de nuevo. Una respuesta tardia no llega
 * a nadie: el worker ya no existe y su id ya no figura en `pending`.
 */
export function cancelCpu(): void {
  epoch++;
  terminateWorker();
  const stuck = [...pending.values()];
  pending.clear();
  for (const p of stuck) {
    if (p.timer !== null) clearTimeout(p.timer);
    p.reject(new Error('cancelado'));
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === 'undefined') return null;
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = pending.get(e.data.id);
      if (!p) return; // respuesta vieja: la peticion fue cancelada o reemplazada
      settle(p);
      if (e.data.error !== undefined) runLocalAsync(p);
      else p.resolve(e.data.result);
    };
    w.onerror = abandonWorker;
    w.onmessageerror = abandonWorker;
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** Una peticion nueva de accion deja obsoleta a cualquier otra de accion en vuelo: el estado ya cambio. */
function supersedeActions(): void {
  const stale = [...pending.values()].filter(p => p.req.kind === 'action');
  if (stale.length === 0) return;
  // El worker no se puede interrumpir de otra forma: se lo recrea para no esperar un calculo inutil.
  terminateWorker();
  for (const p of stale) {
    settle(p);
    p.reject(new Error('cancelado'));
  }
  for (const p of [...pending.values()]) {
    // lo que queda (despliegues) sigue vivo: se vuelve a pedir en el worker nuevo
    settle(p);
    dispatch(p);
  }
}

function dispatch(p: Pending): void {
  const w = getWorker();
  if (!w) {
    runLocalAsync(p);
    return;
  }
  pending.set(p.req.id, p);
  const limit = config.workerTimeoutMs ?? 30000;
  p.timer = setTimeout(() => {
    p.timer = null;
    if (pending.get(p.req.id) === p) abandonWorker();
  }, limit);
  try {
    w.postMessage(p.req);
  } catch {
    settle(p);
    runLocalAsync(p);
  }
}

function request(r: Request): Promise<CpuAction | Placement[]> {
  return new Promise((resolve, reject) => {
    if (r.kind === 'action') {
      actionGen++;
      supersedeActions();
    }
    const req: WorkerRequest = {
      ...r,
      id: nextId++,
      seed: freshSeed(),
      iterations: r.iterations ?? config.iterations,
      timeBudgetMs: r.timeBudgetMs ?? config.timeBudgetMs,
    };
    dispatch({ req, resolve, reject, timer: null, gen: actionGen });
  });
}

export const cpu: CpuApi = {
  requestAction(state: GameState, me: Player, level: CpuLevel): Promise<CpuAction> {
    return request({ kind: 'action', state, me, level }) as Promise<CpuAction>;
  },
  requestSetup(state: GameState, me: Player, level: CpuLevel): Promise<Placement[]> {
    return request({ kind: 'setup', state, me, level }) as Promise<Placement[]>;
  },
};
