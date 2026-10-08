import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settingsStore';
import { useCpuStatus } from '../../store/cpuStatus';
import { cpu, cancelCpu } from '../../ai/cpuClient';
import type { CpuAction } from '../../ai/types';
import { getSetupCells } from '../../engine/board';

const CPU_SIDE = 'B' as const;
const ACTION_PAUSE_MS = 380;
const HANDOFF_PAUSE_MS = 250;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const store = () => useGameStore.getState();

function dispatch(a: CpuAction) {
  switch (a.kind) {
    case 'selectToken': store().selectToken(a.token); break;
    case 'move': store().selectPiece(a.pieceId); store().doMove(a.to); break;
    case 'attack': store().selectPiece(a.attackerId); store().doAttack(a.targetId); break;
    case 'recon': store().selectPiece(a.pieceId); store().doRecon(a.targetId); break;
    case 'placeMine': store().selectPiece(a.pieceId); store().doPlaceMine(a.at); break;
    case 'liftMine': store().selectPiece(a.pieceId); store().doLiftMine(a.at); break;
    case 'endTurn': store().doEndTurn(); break;
  }
}

function fallbackEndTurn() {
  const g = store().game;
  if (g.phase !== 'play' || g.turn !== CPU_SIDE) return;
  if (g.selectedNumberToken === null) {
    const token = g.numberTokens[CPU_SIDE][0];
    if (token !== undefined) store().selectToken(token);
  }
  store().doEndTurn();
}

async function deployFleet() {
  const startGame = store().game;
  const level = useSettings.getState().cpuLevel;
  const placements = await cpu.requestSetup(startGame, CPU_SIDE, level);
  if (store().game !== startGame) return;
  for (const p of placements) store().placePiece(p.pieceId, p.pos);

  const unplaced = store().game.pieces.filter(p => p.owner === CPU_SIDE && p.pos === null);
  for (const piece of unplaced) {
    for (const cell of getSetupCells(CPU_SIDE)) {
      store().placePiece(piece.id, cell);
      if (store().game.pieces.find(p => p.id === piece.id)?.pos) break;
    }
  }
  store().finishSetup();
}

async function playOneAction(failures: { count: number }): Promise<boolean> {
  const startGame = store().game;
  const level = useSettings.getState().cpuLevel;
  useCpuStatus.getState().setThinking(true);
  let action: CpuAction;
  try {
    action = await cpu.requestAction(startGame, CPU_SIDE, level);
  } catch {
    useCpuStatus.getState().setThinking(false);
    fallbackEndTurn();
    return true;
  }
  useCpuStatus.getState().setThinking(false);
  if (store().game !== startGame) return true;

  await sleep(ACTION_PAUSE_MS);
  if (store().game !== startGame) return true;

  dispatch(action);
  if (store().game === startGame) {
    failures.count += 1;
    if (failures.count >= 2) {
      fallbackEndTurn();
      failures.count = 0;
    }
  } else {
    failures.count = 0;
  }
  return true;
}

export function useCpuDriver() {
  const vsCpu = useSettings(s => s.vsCpu);
  const game = useGameStore(s => s.game);
  const running = useRef(false);

  useEffect(() => {
    if (!vsCpu) {
      cancelCpu();
      useCpuStatus.getState().setThinking(false);
      return;
    }
    if (running.current) return;
    running.current = true;

    (async () => {
      const failures = { count: 0 };
      try {
        while (useSettings.getState().vsCpu) {
          const g = store().game;
          if (g.phase === 'handoffPlay') {
            await sleep(HANDOFF_PAUSE_MS);
            if (store().game === g) store().confirmHandoff();
          } else if (g.phase === 'setupB') {
            await deployFleet();
            if (store().game.phase === 'setupB') break;
          } else if (g.phase === 'play' && g.turn === CPU_SIDE) {
            await playOneAction(failures);
          } else {
            break;
          }
        }
      } finally {
        useCpuStatus.getState().setThinking(false);
        running.current = false;
      }
    })();
  }, [vsCpu, game]);

  useEffect(() => () => cancelCpu(), []);
}
