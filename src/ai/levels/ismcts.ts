import type { GameState, Player, UnitType } from '../../engine/types';
import type { CpuAction } from '../types';
import { canSeeIdentity } from '../../engine/gameEngine';
import { actionKey, applyAndAdvance, cellIdx, deriveTurnMemo, enumerateActions } from '../actions';
import { evaluate } from '../evaluate';
import { finishHash, HASH_SEED, mixHash, mulberry32, type Rng } from '../rng';
import { UNIT_TYPES, type LevelContext, type PlayerView } from '../view';
import { makeSampler, type BeliefMode } from './ismctsBelief';
import { findWinPath, greedyTurn, prepareGrids, rolloutTurn, scoreActions, type HiddenInfo, type PolicyParams } from './ismctsPolicy';

/**
 * SO-ISMCTS (Cowling, Powley y Whitehouse 2012): un solo arbol de acciones atomicas, una
 * determinizacion nueva en cada iteracion, UCB1 con conteos de disponibilidad, una expansion por
 * iteracion, rollout heuristico de turnos completos y corte por evaluate().
 *
 * Un turno son varias acciones seguidas del mismo jugador, asi que el arbol no alterna el signo por
 * profundidad: cada arista guarda la recompensa del jugador que la eligio (el que movia en su padre).
 * Las aristas se identifican por la accion con los ids de la vista, que son iguales en todos los
 * mundos, de modo que el conteo de disponibilidad absorbe que cada mundo permite jugadas distintas.
 *
 * Toda la informacion que el nucleo lee de piezas ocultas entra por mundos muestreados
 * (determinize); la vista nunca expone el tipo enemigo y este modulo no accede a otra cosa.
 */

export interface SearchConfig {
  name: string;
  /** Constante de exploracion de UCB (las recompensas estan en [0, 1] pero se agrupan cerca de 0.5). */
  exploration: number;
  /** Peso del sesgo progresivo por prior heuristico. */
  priorBias: number;
  /** Ensanchamiento progresivo: hijos permitidos = widenBase + floor(widenScale * sqrt(visitas)). */
  widenBase: number;
  widenScale: number;
  maxChildrenSelf: number;
  maxChildrenOpp: number;
  /** Profundidad maxima del arbol en acciones atomicas. */
  maxDepth: number;
  /** Cantidad de fines de turno (desde la raiz) tras los cuales se evalua. */
  horizonEnds: number;
  /** Presupuesto en ms cuando el contexto no trae iterations ni timeBudgetMs. */
  defaultTimeMs: number;
  /** Fraccion del presupuesto por defecto que se gasta cuando el arbol se reutiliza (ya hay visitas acumuladas). */
  reuseBudgetFactor: number;
  minIterations: number;
  policy: PolicyParams;
  /** Bonus de recompensa por cada pieza enemiga que deja de ser desconocida en el horizonte. */
  infoBonus: number;
  belief: BeliefMode;
  /** Reutiliza el subarbol entre llamadas del mismo turno (solo si la memoria esta habilitada). */
  reuse: boolean;
  /** Corta cuando la jugada lider ya no puede ser alcanzada por la segunda. */
  earlyStop: boolean;
  /** Corta cuando la lider concentra al menos esta fraccion de las visitas pasada la mitad del presupuesto (0 = nunca). */
  softStopShare: number;
  maxNodes: number;
  /** Numeros aleatorios comunes: la k-esima visita de cada jugada de la raiz usa el mismo mundo k. */
  paired: boolean;
  /** La jugada final es la de mejor media entre las bien visitadas, no la mas visitada. */
  finalByMean: boolean;
  worldPoolMax: number;
  /** En la hoja, si quien mueve ya tiene camino libre a la zona de llegada, la partida cuenta como decidida (evita el efecto horizonte). */
  leafWinCheck: boolean;
}

export interface RootStat {
  key: string;
  visits: number;
  mean: number;
}

export interface SearchOutcome {
  action: CpuAction;
  iterations: number;
  rootStats: RootStat[];
  reused: boolean;
  forced: boolean;
}

interface Edge {
  key: number;
  action: CpuAction;
  byMe: boolean;
  visits: number;
  avail: number;
  total: number;
  prior: number;
  child: Node | null;
  dead: boolean;
}

interface Node {
  edges: Edge[];
  map: Map<number, Edge>;
  visits: number;
}

function newNode(): Node {
  return { edges: [], map: new Map(), visits: 0 };
}

function encodeAction(a: CpuAction, idx: ReadonlyMap<string, number>): number {
  const p = (id: string) => idx.get(id) ?? 0;
  switch (a.kind) {
    case 'selectToken':
      return a.token;
    case 'move':
      return (1 << 20) | (p(a.pieceId) << 9) | cellIdx(a.to.r, a.to.c);
    case 'attack':
      return (2 << 20) | (p(a.attackerId) << 9) | p(a.targetId);
    case 'recon':
      return (3 << 20) | (p(a.pieceId) << 9) | p(a.targetId);
    case 'placeMine':
      return (4 << 20) | (p(a.pieceId) << 9) | cellIdx(a.at.r, a.at.c);
    case 'liftMine':
      return (5 << 20) | (p(a.pieceId) << 9) | cellIdx(a.at.r, a.at.c);
    case 'endTurn':
      return 6 << 20;
  }
}

// ─── Firma de lo observable (para reutilizar el arbol) ───────────────────────

function pieceSig(owner: Player, r: number, c: number, damaged: boolean, typeIdx: number, mask: number): number {
  let h = mixHash(HASH_SEED, owner === 'A' ? 1 : 2);
  h = mixHash(h, r * 32 + c);
  h = mixHash(h, (damaged ? 1 : 0) | (typeIdx << 1) | (mask << 5));
  return finishHash(h);
}

function globalSig(
  turn: Player,
  selected: number | null,
  spent: number,
  flags: number,
  mineActions: number,
  tokensA: readonly number[],
  tokensB: readonly number[],
  mines: GameState['mines'],
): number {
  let h = mixHash(HASH_SEED, turn === 'A' ? 1 : 2);
  h = mixHash(h, selected ?? 0);
  h = mixHash(h, spent);
  h = mixHash(h, flags);
  h = mixHash(h, mineActions);
  for (const t of tokensA) h = mixHash(h, t);
  h = mixHash(h, -1);
  for (const t of tokensB) h = mixHash(h, t);
  let acc = 0;
  for (const m of mines) acc = (acc + finishHash(mixHash(mixHash(h, m.r * 32 + m.c), m.owner === 'A' ? 1 : 2))) | 0;
  return mixHash(h, acc);
}

const revMask = (r: readonly Player[]) => (r.includes('A') ? 1 : 0) | (r.includes('B') ? 2 : 0);

/** Firma canonica (independiente del orden) de todo lo que `me` sabe de la vista. */
function viewSig(view: PlayerView): number {
  let acc = 0;
  for (const p of view.pieces) {
    acc =
      (acc +
        pieceSig(p.owner, p.pos?.r ?? 0, p.pos?.c ?? 0, p.damaged, p.type ? UNIT_TYPES.indexOf(p.type) : 7, revMask(p.revealedTo))) |
      0;
  }
  const flags = (view.attackOrReconUsedThisTurn ? 1 : 0) | (view.combatPlaneAttackUsedThisTurn ? 2 : 0);
  return mixHash(
    globalSig(view.turn, view.selectedNumberToken, view.movementBudgetSpent, flags, view.memo.mineActions, view.numberTokens.A, view.numberTokens.B, view.mines),
    acc,
  );
}

/** La misma firma calculada sobre un mundo determinizado, mirando solo lo que `me` puede ver. */
function worldSig(w: GameState, me: Player): number {
  let acc = 0;
  for (const p of w.pieces) {
    acc =
      (acc +
        pieceSig(p.owner, p.pos?.r ?? 0, p.pos?.c ?? 0, p.damaged, canSeeIdentity(p, me) ? UNIT_TYPES.indexOf(p.type) : 7, revMask(p.revealedTo))) |
      0;
  }
  const flags = (w.attackOrReconUsedThisTurn ? 1 : 0) | (w.combatPlaneAttackUsedThisTurn ? 2 : 0);
  return mixHash(
    globalSig(w.turn, w.selectedNumberToken, w.movementBudgetSpent, flags, deriveTurnMemo(w).mineActions, w.numberTokens.A, w.numberTokens.B, w.mines),
    acc,
  );
}

// ─── Memoria entre llamadas del mismo turno ──────────────────────────────────

interface SearchMemory {
  cfgName: string;
  me: Player;
  sig: number;
  idsKey: string;
  node: Node;
  nodes: number;
}

let memoryEnabled = false;
let memory: SearchMemory | null = null;

/**
 * Activa o desactiva la memoria de busqueda. Apagada (por defecto) cada llamada es una funcion pura de
 * (estado, semilla, iterations); el worker la enciende para reutilizar el arbol entre las acciones
 * de un mismo turno.
 */
export function setSearchMemory(enabled: boolean): void {
  memoryEnabled = enabled;
  if (!enabled) memory = null;
}

export function clearSearchMemory(): void {
  memory = null;
}

export function searchMemoryEnabled(): boolean {
  return memoryEnabled;
}

// ─── Busqueda ────────────────────────────────────────────────────────────────

const now = (): number => performance.now();

/** Quien mueve en `s` y llega a la zona de llegada con su presupuesto (sin que nadie pueda interponerse en su propio turno). */
function immediateWinner(s: GameState): Player | null {
  if (s.phase !== 'play') return null;
  const mover = s.turn;
  let budget = 0;
  if (s.selectedNumberToken === null) {
    for (const t of s.numberTokens[mover]) if (t > budget) budget = t;
  } else budget = s.selectedNumberToken - s.movementBudgetSpent;
  prepareGrids(s);
  return findWinPath(s, mover, budget) ? mover : null;
}

function countHidden(w: GameState, me: Player): number {
  let n = 0;
  for (const p of w.pieces) if (p.owner !== me && p.pos && !canSeeIdentity(p, me)) n++;
  return n;
}

function bestOf(node: Node, legalKeys: ReadonlySet<number>, byMean: boolean): Edge | null {
  let best: Edge | null = null;
  if (byMean) {
    let maxV = 0;
    for (const e of node.edges) if (!e.dead && legalKeys.has(e.key) && e.visits > maxV) maxV = e.visits;
    for (const e of node.edges) {
      if (e.dead || e.visits < Math.max(1, 0.15 * maxV) || !legalKeys.has(e.key)) continue;
      if (best === null || e.total / e.visits > best.total / best.visits) best = e;
    }
    if (best !== null) return best;
  }
  for (const e of node.edges) {
    if (e.dead || e.visits === 0 || !legalKeys.has(e.key)) continue;
    if (best === null || e.visits > best.visits || (e.visits === best.visits && e.total / e.visits > best.total / best.visits)) best = e;
  }
  return best;
}

export function searchDetailed(ctx: LevelContext, cfg: SearchConfig, sampler?: (rng: Rng) => GameState): SearchOutcome {
  const { view, me, legal, rng } = ctx;
  const pieceIndex = new Map<string, number>();
  view.pieces.forEach((p, i) => pieceIndex.set(p.id, i));
  const legalKeys = new Set(legal.map(a => encodeAction(a, pieceIndex)));
  const hiddenInfo: HiddenInfo = (() => {
    const hidden = new Set<number>();
    view.pieces.forEach((p, i) => {
      if (p.type === null && p.pos !== null) hidden.add(i);
    });
    const counts = new Map<UnitType, number>();
    for (const t of view.unknownPool) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { hidden, searcher: me, pool: [...counts], total: Math.max(1, view.unknownPool.length) };
  })();
  const sample = sampler ? () => sampler(rng) : (() => {
    const s = makeSampler(view, cfg.belief);
    return () => s(rng);
  })();

  const fallback = (forced: boolean, reused: boolean, iterations: number, rootStats: RootStat[]): SearchOutcome => {
    const w = sample();
    prepareGrids(w);
    const scores = new Float64Array(legal.length);
    scoreActions(w, legal, pieceIndex, -1, scores, hiddenInfo);
    let bi = 0;
    for (let i = 1; i < legal.length; i++) if (scores[i] > scores[bi]) bi = i;
    return { action: legal[bi], iterations, rootStats, reused, forced };
  };

  // 1. Victoria inmediata dentro del turno (solo posiciones; independiente de tipos ocultos).
  const w0 = sample();
  prepareGrids(w0);
  if (view.selectedNumberToken === null) {
    let max = 0;
    for (const t of view.numberTokens[me]) if (t > max) max = t;
    const wp = findWinPath(w0, me, max);
    if (wp) {
      let pick = max;
      for (const t of view.numberTokens[me]) if (t >= wp.cost && t < pick) pick = t;
      const hit = legal.find(a => a.kind === 'selectToken' && a.token === pick);
      if (hit) return { action: hit, iterations: 0, rootStats: [], reused: false, forced: true };
    }
  } else {
    const wp = findWinPath(w0, me, view.selectedNumberToken - view.movementBudgetSpent);
    if (wp) {
      const id = w0.pieces[wp.pieceIdx].id;
      const to = wp.cells[0];
      const hit = legal.find(a => a.kind === 'move' && a.pieceId === id && a.to.r === to.r && a.to.c === to.c);
      if (hit) return { action: hit, iterations: 0, rootStats: [], reused: false, forced: true };
    }
  }

  // 2. Raiz (posiblemente reutilizada).
  const idsKey = view.pieces.map(p => p.id).join('|');
  let root = newNode();
  let nodeCount = 1;
  let reused = false;
  if (memoryEnabled && cfg.reuse && memory && memory.cfgName === cfg.name && memory.me === me && memory.idsKey === idsKey && memory.sig === viewSig(view)) {
    root = memory.node;
    nodeCount = memory.nodes;
    reused = true;
  }
  memory = null;

  const hidden0 = countHidden(w0, me);
  const scratchW = new Float64Array(160);
  let scratchK = new Int32Array(160);
  const horizon = cfg.horizonEnds;
  const C = cfg.exploration;
  const B = cfg.priorBias;
  const rollSeed = Math.floor(rng() * 4294967296) >>> 0;

  const worldPool: GameState[] = [w0];
  const getWorld = (k: number): GameState => {
    if (!cfg.paired || k >= cfg.worldPoolMax) return sample();
    while (worldPool.length <= k) worldPool.push(sample());
    return worldPool[k];
  };

  const widenLimit = (node: Node, mine: boolean): number => {
    const cap = mine ? cfg.maxChildrenSelf : cfg.maxChildrenOpp;
    return Math.min(cap, cfg.widenBase + Math.floor(cfg.widenScale * Math.sqrt(node.visits)));
  };

  let created = false;
  /** Elige la arista de `node` entre `acts` (UCB con disponibilidad) o expande una nueva por prior. */
  const select = (node: Node, acts: readonly CpuAction[], scoreState: GameState, mine: boolean, lastMoved: number): Edge | null => {
    const n = acts.length;
    created = false;
    let best: Edge | null = null;
    let bestVal = -Infinity;
    let existing = 0;
    let unexpanded = 0;
    if (scratchK.length < n) scratchK = new Int32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const key = encodeAction(acts[i], pieceIndex);
      scratchK[i] = key;
      const e = node.map.get(key);
      if (e === undefined) {
        unexpanded++;
        continue;
      }
      if (e.dead) continue;
      e.avail++;
      existing++;
      const v =
        e.visits === 0
          ? Infinity
          : e.total / e.visits + C * Math.sqrt(Math.log(e.avail) / e.visits) + (B * e.prior) / (e.visits + 1);
      if (v > bestVal) {
        bestVal = v;
        best = e;
      }
    }
    node.visits++;
    const tokenNode = acts[0].kind === 'selectToken';
    if (unexpanded > 0 && nodeCount < cfg.maxNodes && (tokenNode || existing < widenLimit(node, mine))) {
      prepareGrids(scoreState);
      const w = n <= scratchW.length ? scratchW : new Float64Array(n);
      scoreActions(scoreState, acts, pieceIndex, lastMoved, w, hiddenInfo);
      let maxW = 0;
      for (let i = 0; i < n; i++) if (w[i] > maxW) maxW = w[i];
      let pick = -1;
      let pickW = -1;
      for (let i = 0; i < n; i++) {
        if (node.map.has(scratchK[i])) continue;
        const wi = w[i] + rng() * 1e-6;
        if (wi > pickW) {
          pickW = wi;
          pick = i;
        }
      }
      if (pick !== -1) {
        const a = acts[pick];
        const key = encodeAction(a, pieceIndex);
        const e: Edge = {
          key,
          action: a,
          byMe: mine,
          visits: 0,
          avail: 1,
          total: 0,
          prior: maxW > 0 ? w[pick] / maxW : 1,
          child: null,
          dead: false,
        };
        node.edges.push(e);
        node.map.set(key, e);
        nodeCount++;
        created = true;
        return e;
      }
    }
    return best;
  };

  const iterate = (): void => {
    const path: Edge[] = [];
    let lastMoved = -1;
    let ends = 0;
    let depth = 0;

    const rootEdge = select(root, legal, w0, true, -1);
    if (rootEdge === null) return;
    const widx = rootEdge.visits;
    let state = getWorld(widx);
    const first = applyAndAdvance(state, rootEdge.action);
    if (typeof first === 'string') {
      rootEdge.dead = true;
      return;
    }
    state = first;
    path.push(rootEdge);
    depth = 1;
    if (rootEdge.action.kind === 'endTurn') ends++;
    else if (rootEdge.action.kind === 'move') lastMoved = pieceIndex.get(rootEdge.action.pieceId) ?? -1;
    const stop = created;
    let node: Node = rootEdge.child ?? (rootEdge.child = newNode());

    while (!stop && state.phase !== 'finished' && ends < horizon && depth < cfg.maxDepth) {
      const mover = state.turn;
      const acts = enumerateActions(state, mover, undefined, { verify: false });
      if (acts.length === 0) break;
      const chosen = select(node, acts, state, mover === me, lastMoved);
      if (chosen === null) break;
      const next = applyAndAdvance(state, chosen.action);
      if (typeof next === 'string') {
        chosen.dead = true;
        break;
      }
      path.push(chosen);
      if (chosen.action.kind === 'endTurn') ends++;
      else if (chosen.action.kind === 'move') lastMoved = pieceIndex.get(chosen.action.pieceId) ?? -1;
      state = next;
      depth++;
      if (created) break;
      node = chosen.child ?? (chosen.child = newNode());
    }

    const rr = cfg.paired ? mulberry32((rollSeed ^ Math.imul(widx + 1, 0x9e3779b1)) >>> 0) : rng;
    let leaf = state;
    while (leaf.phase !== 'finished' && ends < horizon) {
      let nx: GameState;
      if (cfg.policy.greedyAll || (cfg.policy.greedyOpp && leaf.turn !== me)) nx = greedyTurn(leaf);
      else if (cfg.policy.oppSamples > 1 && leaf.turn !== me) {
        nx = rolloutTurn(leaf, rr, cfg.policy);
        let worst = nx === leaf ? Infinity : evaluate(nx, me);
        for (let k = 1; k < cfg.policy.oppSamples; k++) {
          const cand = rolloutTurn(leaf, rr, cfg.policy);
          if (cand === leaf) continue;
          const v = evaluate(cand, me);
          if (v < worst) {
            worst = v;
            nx = cand;
          }
        }
      } else nx = rolloutTurn(leaf, rr, cfg.policy);
      if (nx === leaf) break;
      leaf = nx;
      ends++;
    }
    const decided = cfg.leafWinCheck ? immediateWinner(leaf) : null;
    let r = decided !== null ? (decided === me ? 1 : 0) : (evaluate(leaf, me) + 1) / 2;
    if (cfg.infoBonus !== 0 && leaf.phase !== 'finished' && decided === null) r += cfg.infoBonus * (hidden0 - countHidden(leaf, me));
    r = r < 0 ? 0 : r > 1 ? 1 : r;
    for (const e of path) {
      e.visits++;
      e.total += e.byMe ? r : 1 - r;
    }
  };

  // 3. Presupuesto.
  const hasIter = ctx.iterations !== undefined;
  const hasTime = ctx.timeBudgetMs !== undefined;
  const maxIter = hasIter ? Math.max(1, ctx.iterations as number) : Infinity;
  const timed = hasTime || !hasIter;
  const budgetMs = hasTime ? (ctx.timeBudgetMs as number) : cfg.defaultTimeMs * (reused ? cfg.reuseBudgetFactor : 1);
  const t0 = timed ? now() : 0;

  let it = 0;
  for (; it < maxIter; it++) {
    if (timed && (it & 7) === 0 && it > 0 && now() - t0 >= budgetMs) break;
    iterate();
    if ((it & 31) === 31 && it + 1 >= cfg.minIterations && root.edges.length > 1) {
      let v1 = 0;
      let v2 = 0;
      let tot = 0;
      for (const e of root.edges) {
        tot += e.visits;
        if (e.visits > v1) {
          v2 = v1;
          v1 = e.visits;
        } else if (e.visits > v2) v2 = e.visits;
      }
      if (cfg.earlyStop) {
        const left = timed ? Math.max(0, ((budgetMs - (now() - t0)) / Math.max(1e-3, now() - t0)) * (it + 1)) : maxIter - it - 1;
        if (v1 - v2 > Math.min(left, maxIter === Infinity ? left : maxIter - it - 1)) {
          it++;
          break;
        }
      }
      if (cfg.softStopShare > 0 && tot > 0 && v1 / tot >= cfg.softStopShare) {
        const spentFrac = timed ? (now() - t0) / budgetMs : (it + 1) / maxIter;
        if (spentFrac >= 0.5) {
          it++;
          break;
        }
      }
    }
  }

  const chosen = bestOf(root, legalKeys, cfg.finalByMean);
  const rootStats: RootStat[] = root.edges
    .filter(e => !e.dead)
    .map(e => ({ key: actionKey(e.action), visits: e.visits, mean: e.visits > 0 ? e.total / e.visits : 0 }))
    .sort((a, b) => b.visits - a.visits);
  if (chosen === null) return fallback(false, reused, it, rootStats);

  if (memoryEnabled && cfg.reuse && chosen.action.kind !== 'attack' && chosen.action.kind !== 'recon' && chosen.action.kind !== 'endTurn') {
    const after = applyAndAdvance(w0, chosen.action);
    if (typeof after !== 'string' && after.phase === 'play' && after.turn === me) {
      memory = { cfgName: cfg.name, me, sig: worldSig(after, me), idsKey, node: (chosen.child ??= newNode()), nodes: nodeCount };
    }
  }
  const out = legal.find(a => encodeAction(a, pieceIndex) === chosen.key) ?? chosen.action;
  return { action: out, iterations: it, rootStats, reused, forced: false };
}

export function searchAction(ctx: LevelContext, cfg: SearchConfig): CpuAction {
  return searchDetailed(ctx, cfg).action;
}
