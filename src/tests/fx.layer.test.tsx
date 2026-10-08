// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Piece } from '../engine/types';
import { useFxStore, type ActiveFx } from '../fx/fxStore';
import type { FxSpec } from '../fx/types';
import { useSettings } from '../store/settingsStore';
import { CellPiece } from '../ui/fx/CellPiece';
import { DamagedFlames } from '../ui/fx/DamagedFlames';
import { FxLayer } from '../ui/fx/FxLayer';

vi.mock('../fx/audio', () => ({
  playSound: vi.fn(),
  unlockAudio: vi.fn(),
  setAudioEnabled: vi.fn(),
  setMasterVolume: vi.fn(),
  SOUND_LIST: [],
  renderSoundOffline: async () => null,
}));

let seq = 1000;

function addFx(spec: FxSpec): ActiveFx {
  const fx: ActiveFx = { id: seq++, t0: performance.now(), spec };
  act(() => { useFxStore.setState(s => ({ effects: [...s.effects, fx] })); });
  return fx;
}

const battleship = (over: Partial<Piece> = {}): Piece => ({
  id: 'B-Acorazado-0', owner: 'B', type: 'Acorazado', pos: { r: 9, c: 9 }, damaged: false, revealedTo: ['A', 'B'], ...over,
});

beforeEach(() => {
  useSettings.getState().set({ fxOn: true });
  useFxStore.getState().clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FxLayer', () => {
  it('no dibuja nada sin efectos', () => {
    const { container } = render(<FxLayer cellSize={20} rot={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('el proyectil sigue el eje del disparo en pantalla según la rotación del tablero', () => {
    const from = { r: 5, c: 3 };
    const to = { r: 5, c: 8 };
    const { container } = render(<FxLayer cellSize={20} rot={0} />);
    addFx({ type: 'shell', at: 0, dur: 400, from, to });
    // rot 0: la fila 5 es horizontal, el proyectil sale de la columna 3 hacia la derecha.
    let axis = container.querySelector<HTMLElement>('[style*="rotate("]')!;
    expect(axis.style.transform).toBe('rotate(0deg)');
    expect(axis.style.left).toBe('50px');
    expect(axis.style.top).toBe('90px');

    cleanup();
    const rotated = render(<FxLayer cellSize={20} rot={90} />);
    addFx({ type: 'shell', at: 0, dur: 400, from, to });
    // rot 90: la misma fila pasa a ser una columna y el disparo baja.
    axis = rotated.container.querySelector<HTMLElement>('[style*="rotate("]')!;
    expect(axis.style.transform).toBe('rotate(90deg)');
    expect(axis.style.left).toBe('310px');
    expect(axis.style.top).toBe('50px');
  });

  it('el fantasma dibuja la ficha hundida en su celda, con su identidad visible', () => {
    render(<FxLayer cellSize={30} rot={0} />);
    addFx({ type: 'ghost', at: 0, dur: 600, cell: { r: 4, c: 6 }, unit: 'Crucero', owner: 'B', damaged: false });
    const token = screen.getByTitle('Crucero (J.B)');
    const cell = token.parentElement!.parentElement!.parentElement!;
    expect(cell.style.left).toBe('150px');
    expect(cell.style.top).toBe('90px');
    expect(cell.style.width).toBe('30px');
  });

  it('un efecto nuevo no reinicia a los que ya estaban corriendo', () => {
    const { container } = render(<FxLayer cellSize={20} rot={0} />);
    addFx({ type: 'explosion', at: 0, dur: 1100, cell: { r: 3, c: 3 }, size: 'large' });
    const ring = container.querySelector('svg')!;
    // El splash va en una capa más baja: se inserta antes en el DOM, sin mover ni recrear la explosión.
    addFx({ type: 'splash', at: 0, dur: 1200, cell: { r: 6, c: 6 }, size: 'small' });
    addFx({ type: 'sparks', at: 0, dur: 600, cell: { r: 8, c: 8 } });
    expect(ring.isConnected).toBe(true);
    expect(container.querySelectorAll('svg')).toContain(ring);
  });

  it('el retardo de la animación descuenta el tiempo que el efecto ya lleva', () => {
    const { container } = render(<FxLayer cellSize={20} rot={0} />);
    const fx: ActiveFx = { id: seq++, t0: performance.now() - 200, spec: { type: 'shell', at: 500, dur: 400, from: { r: 5, c: 3 }, to: { r: 5, c: 8 } } };
    act(() => { useFxStore.setState({ effects: [fx] }); });
    const moving = container.querySelector<HTMLElement>('[style*="fx-fly"]')!;
    const delay = Number(/fx-fly \d+ms linear (-?\d+)ms/.exec(moving.style.animation)![1]);
    expect(delay).toBeGreaterThan(280);
    expect(delay).toBeLessThanOrEqual(300);
  });
});

describe('movimiento reducido', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const sparks = () => {
    const { container } = render(<FxLayer cellSize={30} rot={0} />);
    addFx({ type: 'explosion', at: 0, dur: 1100, cell: { r: 5, c: 5 }, size: 'large' });
    const n = container.querySelectorAll('[style*="fx-spark-fly"]').length;
    cleanup();
    useFxStore.getState().clear();
    return n;
  };

  it('la explosión lanza menos chispas', () => {
    const normal = sparks();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(normal).toBe(14);
    expect(sparks()).toBe(4);
  });

  it('las llamas no tienen brasas ni hilo de humo', () => {
    const extras = () => {
      const { container } = render(<DamagedFlames cellSize={40} seed="A-Crucero-0" />);
      const n = container.querySelectorAll('[style*="fx-ember"], [style*="fx-smoke-thread"]').length;
      cleanup();
      return n;
    };
    expect(extras()).toBe(4);
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(extras()).toBe(0);
  });
});

describe('DamagedFlames', () => {
  const tongues = (cellSize: number) => render(<DamagedFlames cellSize={cellSize} seed="A-Crucero-0" />)
    .container.querySelectorAll('.fx-flick').length;

  it('usa menos lenguas en celdas chicas', () => {
    expect(tongues(14)).toBe(3);
    cleanup();
    expect(tongues(24)).toBe(4);
    cleanup();
    expect(tongues(50)).toBe(5);
  });

  it('no se dibuja con las animaciones de combate apagadas', () => {
    act(() => { useSettings.getState().set({ fxOn: false }); });
    const { container } = render(<DamagedFlames cellSize={40} seed="A-Crucero-0" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('CellPiece', () => {
  const props = { viewAs: 'A' as const, selected: false, enlarge: false, targetable: false, cellSize: 40 };

  it('un barco averiado arde de inmediato si no hay proyectil en camino', () => {
    const { container } = render(<CellPiece piece={battleship({ damaged: true })} {...props} />);
    expect(screen.getByTitle('Acorazado (J.B) · averiado')).toBeTruthy();
    expect(container.querySelectorAll('.fx-flick').length).toBe(5);
  });

  it('espera al impacto para mostrarse averiado y con llamas', () => {
    vi.useFakeTimers();
    addFx({ type: 'explosion', at: 440, dur: 1100, cell: { r: 9, c: 9 }, size: 'medium' });
    const { container } = render(<CellPiece piece={battleship({ damaged: true })} {...props} />);
    expect(screen.getByTitle('Acorazado (J.B)')).toBeTruthy();
    expect(container.querySelectorAll('.fx-flick').length).toBe(0);

    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByTitle('Acorazado (J.B) · averiado')).toBeTruthy();
    expect(container.querySelectorAll('.fx-flick').length).toBe(5);
  });

  it('una explosión en otra celda no retrasa a la ficha', () => {
    addFx({ type: 'explosion', at: 440, dur: 1100, cell: { r: 2, c: 2 }, size: 'medium' });
    render(<CellPiece piece={battleship({ damaged: true })} {...props} />);
    expect(screen.getByTitle('Acorazado (J.B) · averiado')).toBeTruthy();
  });
});
