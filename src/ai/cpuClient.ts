import type { CpuApi } from './types';

// Reemplazo provisorio: la CPU todavía no está disponible (CPU_AVAILABLE = false).
const unavailable = () => Promise.reject(new Error('CPU no disponible'));

export const cpu: CpuApi = {
  requestAction: unavailable,
  requestSetup: unavailable,
};

export function cancelCpu(): void {}
