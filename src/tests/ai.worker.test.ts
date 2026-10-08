import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../engine/types';
import type { CpuAction, CpuLevel } from '../ai/types';
import { createInitialState } from '../engine/gameEngine';
import { applyCpuAction } from '../ai/actions';
import { cancelCpu, configureCpu, cpu } from '../ai/cpuClient';
import { searchMemoryEnabled } from '../ai/levels/ismcts';
import { handleRequest, type WorkerRequest, type WorkerResponse } from '../ai/worker';
import { randomPlayState } from './ai.helpers';

const state = (): GameState => randomPlayState(4, { turns: 2 });

class FakeWorker {
  static instances: FakeWorker[] = [];
  static mode: 'echo' | 'hold' | 'error' | 'crash' | 'silent' | 'throw' = 'echo';
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  terminated = false;
  received: WorkerRequest[] = [];
  held: WorkerRequest[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(req: WorkerRequest): void {
    this.received.push(req);
    switch (FakeWorker.mode) {
      case 'throw':
        throw new Error('no se puede enviar');
      case 'hold':
        this.held.push(req);
        break;
      case 'silent':
        break;
      case 'crash':
        setTimeout(() => this.onerror?.(new Error('boom')), 0);
        break;
      case 'error':
        setTimeout(() => this.onmessage?.({ data: { id: req.id, error: 'fallo interno' } } as MessageEvent<WorkerResponse>), 0);
        break;
      case 'echo':
        setTimeout(() => {
          if (!this.terminated) this.onmessage?.({ data: handleRequest(req) } as MessageEvent<WorkerResponse>);
        }, 0);
        break;
    }
  }

  /** Entrega las respuestas retenidas, incluso si el worker ya fue terminado (carrera). */
  flush(): void {
    for (const req of this.held.splice(0)) this.onmessage?.({ data: handleRequest(req) } as MessageEvent<WorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function resetClient(): void {
  cancelCpu();
  configureCpu({ iterations: undefined, timeBudgetMs: undefined, workerTimeoutMs: undefined });
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
  FakeWorker.mode = 'echo';
}

afterEach(resetClient);

describe('handleRequest (la logica del worker)', () => {
  it('responde acciones legales de los niveles 4 y 5 y despliegues, sin lanzar', () => {
    const s = state();
    for (const level of [4, 5] as const) {
      const r = handleRequest({ id: 7, kind: 'action', state: s, me: s.turn, level, seed: 3, iterations: 30 });
      expect(r.id).toBe(7);
      expect(r.error).toBeUndefined();
      expect(typeof applyCpuAction(s, r.result as CpuAction)).not.toBe('string');
    }
    const setup = handleRequest({ id: 8, kind: 'setup', state: createInitialState(), me: 'B', level: 4, seed: 1 });
    expect(setup.error).toBeUndefined();
    expect(setup.result).toHaveLength(16);
  });

  it('es determinista para la misma semilla e iterations', () => {
    const s = state();
    const req: WorkerRequest = { id: 1, kind: 'action', state: s, me: s.turn, level: 5, seed: 99, iterations: 40 };
    expect(handleRequest(req)).toEqual(handleRequest({ ...req, id: 1 }));
  });

  it('reporta el error sin lanzar ante un estado invalido y conserva el id', () => {
    const bad = handleRequest({ id: 12, kind: 'setup', state: null as unknown as GameState, me: 'A', level: 4 });
    expect(bad.id).toBe(12);
    expect(typeof bad.error).toBe('string');
    // una accion sobre un estado invalido degrada a endTurn en lugar de fallar
    const act = handleRequest({ id: 13, kind: 'action', state: null as unknown as GameState, me: 'A', level: 5 });
    expect(act).toEqual({ id: 13, result: { kind: 'endTurn' } });
  });

  it('importar el worker en el hilo principal no enciende la memoria de busqueda', () => {
    expect(searchMemoryEnabled()).toBe(false);
  });
});

describe('cpuClient sin Worker (hilo principal)', () => {
  beforeEach(() => configureCpu({ iterations: 25 }));

  it('resuelve acciones y despliegues de todos los niveles', async () => {
    const s = state();
    for (const level of [1, 2, 3, 4, 5] as CpuLevel[]) {
      const a = await cpu.requestAction(s, s.turn, level);
      expect(typeof applyCpuAction(s, a)).not.toBe('string');
    }
    expect(await cpu.requestSetup(createInitialState(), 'A', 5)).toHaveLength(16);
  });

  it('cancelCpu rechaza lo pendiente y el cliente sigue sirviendo despues', async () => {
    const s = state();
    const pending = cpu.requestAction(s, s.turn, 4);
    cancelCpu();
    await expect(pending).rejects.toThrow('cancelado');
    await expect(cpu.requestAction(s, s.turn, 4)).resolves.toBeDefined();
  });

  it('una peticion de accion nueva deja obsoleta a la anterior', async () => {
    const s = state();
    const old = cpu.requestAction(s, s.turn, 4);
    const fresh = cpu.requestAction(s, s.turn, 4);
    await expect(old).rejects.toThrow('cancelado');
    await expect(fresh).resolves.toBeDefined();
  });

  it('un despliegue pedido antes no se pierde por una accion posterior', async () => {
    const s = state();
    const setup = cpu.requestSetup(createInitialState(), 'A', 4);
    const act = cpu.requestAction(s, s.turn, 4);
    await expect(setup).resolves.toHaveLength(16);
    await expect(act).resolves.toBeDefined();
  });
});

describe('cpuClient con Worker', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker);
    configureCpu({ iterations: 25 });
  });

  it('manda la peticion con id y semilla frescos y resuelve la respuesta', async () => {
    const s = state();
    const a = await cpu.requestAction(s, s.turn, 5);
    expect(typeof applyCpuAction(s, a)).not.toBe('string');
    expect(FakeWorker.instances).toHaveLength(1);
    const w = FakeWorker.instances[0];
    expect(w.received).toHaveLength(1);
    expect(w.received[0].kind).toBe('action');
    expect(w.received[0].level).toBe(5);
    expect(typeof w.received[0].seed).toBe('number');
    expect(w.received[0].iterations).toBe(25);
    await cpu.requestSetup(createInitialState(), 'A', 4);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(w.received.map(r => r.id)[1]).toBeGreaterThan(w.received[0].id);
  });

  it('descarta la respuesta vieja de un worker cancelado y rechaza la promesa', async () => {
    FakeWorker.mode = 'hold';
    const s = state();
    const p = cpu.requestAction(s, s.turn, 4);
    const w = FakeWorker.instances[0];
    cancelCpu();
    expect(w.terminated).toBe(true);
    await expect(p).rejects.toThrow('cancelado');
    expect(() => w.flush()).not.toThrow();

    FakeWorker.mode = 'echo';
    await expect(cpu.requestAction(s, s.turn, 4)).resolves.toBeDefined();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].terminated).toBe(false);
  });

  it('una accion nueva reemplaza a la anterior: la vieja se rechaza y su respuesta tardia no pisa a la nueva', async () => {
    FakeWorker.mode = 'hold';
    const s = state();
    const old = cpu.requestAction(s, s.turn, 4);
    const first = FakeWorker.instances[0];
    FakeWorker.mode = 'echo';
    const fresh = cpu.requestAction(s, s.turn, 4);
    await expect(old).rejects.toThrow('cancelado');
    expect(first.terminated).toBe(true);
    first.flush();
    const a = await fresh;
    expect(typeof applyCpuAction(s, a)).not.toBe('string');
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('un error devuelto por el worker se resuelve en el hilo principal', async () => {
    FakeWorker.mode = 'error';
    const s = state();
    const a = await cpu.requestAction(s, s.turn, 4);
    expect(typeof applyCpuAction(s, a)).not.toBe('string');
  });

  it('si el worker se cae (onerror) se lo abandona y se resuelve en el hilo principal', async () => {
    FakeWorker.mode = 'crash';
    const s = state();
    const a = await cpu.requestAction(s, s.turn, 5);
    expect(typeof applyCpuAction(s, a)).not.toBe('string');
    expect(FakeWorker.instances[0].terminated).toBe(true);
    // el siguiente pedido intenta con un worker nuevo? no: tras abandonar se queda en el hilo principal
    FakeWorker.mode = 'echo';
    await expect(cpu.requestAction(s, s.turn, 4)).resolves.toBeDefined();
  });

  it('si el worker no responde a tiempo, el vigilante lo abandona y resuelve localmente', async () => {
    FakeWorker.mode = 'silent';
    configureCpu({ workerTimeoutMs: 25 });
    const s = state();
    const a = await cpu.requestAction(s, s.turn, 4);
    expect(typeof applyCpuAction(s, a)).not.toBe('string');
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('si no se puede enviar el mensaje cae al hilo principal', async () => {
    FakeWorker.mode = 'throw';
    const s = state();
    const a = await cpu.requestAction(s, s.turn, 4);
    expect(typeof applyCpuAction(s, a)).not.toBe('string');
  });

  it('cancelCpu con un despliegue pendiente lo rechaza', async () => {
    FakeWorker.mode = 'hold';
    const p = cpu.requestSetup(createInitialState(), 'B', 4);
    cancelCpu();
    await expect(p).rejects.toThrow('cancelado');
  });
});
