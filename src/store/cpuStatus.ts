import { create } from 'zustand';

interface CpuStatus {
  thinking: boolean;
  setThinking: (v: boolean) => void;
}

export const useCpuStatus = create<CpuStatus>(set => ({
  thinking: false,
  setThinking: v => set({ thinking: v }),
}));
