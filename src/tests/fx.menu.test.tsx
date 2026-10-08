// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSettings } from '../store/settingsStore';
import { HamburgerMenu, MuteButton } from '../ui/components/HamburgerMenu';
import type { SoundInfo } from '../fx/audio';

const audio = vi.hoisted(() => ({
  list: [] as SoundInfo[],
  playSound: vi.fn(),
  unlockAudio: vi.fn(),
  setAudioEnabled: vi.fn(),
  setMasterVolume: vi.fn(),
}));

vi.mock('../fx/audio', () => ({
  get SOUND_LIST() { return audio.list; },
  playSound: audio.playSound,
  unlockAudio: audio.unlockAudio,
  setAudioEnabled: audio.setAudioEnabled,
  setMasterVolume: audio.setMasterVolume,
  renderSoundOffline: async () => null,
}));

const STORAGE_KEY = 'ajedrez-naval-settings-v2';

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
}

/** El panel está oculto (visibility) hasta tocar el botón ☰. */
function openMenu() {
  render(<HamburgerMenu />);
  fireEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
}

beforeEach(() => {
  useSettings.getState().set({ soundOn: true, soundVolume: 0.8, fxOn: true });
  audio.list = [
    { id: 'cannon', label: 'Cañonazo', blurb: 'Disparo de un barco', defaultDur: 1.2 },
    { id: 'sonar', label: 'Sonar', blurb: 'Ping del submarino', defaultDur: 2.5 },
  ];
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('botón rápido de silencio', () => {
  it('alterna soundOn y lo guarda', () => {
    render(<MuteButton />);
    const btn = screen.getByRole('button', { name: 'Silenciar' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.title).toBe('Silenciar');

    fireEvent.click(btn);
    expect(useSettings.getState().soundOn).toBe(false);
    expect(stored().soundOn).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.title).toBe('Activar sonido');

    fireEvent.click(btn);
    expect(useSettings.getState().soundOn).toBe(true);
    expect(audio.unlockAudio).toHaveBeenCalledTimes(1);
  });
});

describe('sección "Sonido y efectos" del menú', () => {
  it('el interruptor de sonido, el volumen y las animaciones cambian los ajustes', () => {
    openMenu();
    const volume = screen.getByRole('slider', { name: 'Volumen' }) as HTMLInputElement;
    expect(volume.disabled).toBe(false);

    fireEvent.change(volume, { target: { value: '0.35' } });
    expect(useSettings.getState().soundVolume).toBeCloseTo(0.35);
    expect(stored().soundVolume).toBeCloseTo(0.35);
    expect(screen.getByText('35%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Animaciones de combate' }));
    expect(useSettings.getState().fxOn).toBe(false);
    expect(stored().fxOn).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Sonido' }));
    expect(useSettings.getState().soundOn).toBe(false);
    expect(volume.disabled).toBe(true);
  });

  it('el bloque de prueba arranca cerrado y reproduce cada sonido con su duración', () => {
    openMenu();
    expect(screen.queryByRole('button', { name: 'Cañonazo' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Probar sonidos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Sonar' }));

    expect(audio.unlockAudio).toHaveBeenCalled();
    expect(audio.setMasterVolume).toHaveBeenCalledWith(0.8);
    expect(audio.playSound).toHaveBeenCalledWith('sonar', { dur: 2.5 });
    expect(screen.getByText('Ping del submarino', { exact: false })).toBeTruthy();
  });

  it('con el sonido apagado avisa y deshabilita los botones de prueba', () => {
    useSettings.getState().set({ soundOn: false });
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /Probar sonidos/ }));

    expect(screen.getByText('Activá el sonido para probar.')).toBeTruthy();
    const cannon = screen.getByRole('button', { name: 'Cañonazo' }) as HTMLButtonElement;
    expect(cannon.disabled).toBe(true);
    fireEvent.click(cannon);
    expect(audio.playSound).not.toHaveBeenCalled();
  });

  it('sin sonidos registrados no muestra el bloque de prueba', () => {
    audio.list = [];
    openMenu();
    expect(screen.queryByRole('button', { name: /Probar sonidos/ })).toBeNull();
  });
});
