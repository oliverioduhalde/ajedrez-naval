import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    // Los tests de fuerza de la CPU simulan partidas enteras: con la máquina ocupada superan los 5 s por defecto.
    testTimeout: 120000,
  },
});
