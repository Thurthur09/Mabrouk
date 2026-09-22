import { expect } from 'vitest';
import { defaultPosition } from '../cards';
import { DEFAULT_CONFIG, makeConfig } from '../config';
import { applyAction, createGame } from '../engine';
import type { Action, GameConfig, GameEvent, GameState, PlayerId } from '../types';

export const SEED = [1, 2, 3, 4, 5, 6, 7, 8];
export const NOW = 1_000_000;

export function ids(n: number): PlayerId[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

export function newGame(n = 3, config: Partial<GameConfig> = {}, seed = SEED): GameState {
  return createGame(
    makeConfig(config),
    ids(n).map((id) => ({ id, name: id.toUpperCase() })),
    seed,
  );
}

export interface RigSpec {
  hands?: Record<PlayerId, string[]>;
  /** Rang de la carte visible sur la défausse. */
  discard?: string;
  /** Rangs des prochaines cartes piochées, dans l'ordre. */
  deck?: string[];
}

/** Réattribue les cartes (les ids sont conservés) pour construire une situation précise. */
export function rig(state: GameState, spec: RigSpec): GameState {
  const pool: Record<string, string[]> = {};
  for (const c of Object.values(state.cards)) (pool[c.rank] ??= []).push(c.id);
  const take = (rank: string): string => {
    const id = pool[rank]?.pop();
    if (!id) throw new Error('plus de carte ' + rank);
    return id;
  };
  const hands: Record<PlayerId, string[]> = {};
  for (const p of state.players) {
    hands[p.id] = (spec.hands?.[p.id] ?? p.hand.map((id) => state.cards[id].rank)).map(take);
  }
  const discard = take(spec.discard ?? state.cards[state.discardPile[state.discardPile.length - 1]].rank);
  const drawOrder = (spec.deck ?? []).map(take);
  const rest = Object.values(pool).flat();
  for (const c of Object.values(state.cards)) {
    c.location = 'deck';
    c.owner = null;
    c.isFaceUp = false;
    c.pos = null;
  }
  for (const p of state.players) {
    p.hand = hands[p.id];
    p.hand.forEach((id, i) => {
      const c = state.cards[id];
      c.location = 'hand';
      c.owner = p.id;
      c.pos = defaultPosition(i, state.config.gridColumns);
    });
  }
  state.discardPile = [discard];
  state.cards[discard].location = 'discard';
  state.cards[discard].isFaceUp = true;
  state.deck = [...rest, ...drawOrder.reverse()];
  return state;
}

export function act(state: GameState, pid: PlayerId, action: Action, now = NOW): { state: GameState; events: GameEvent[] } {
  const res = applyAction(state, pid, action, { now });
  if (!res.ok) throw new Error(`Action refusée (${action.type}) : ${res.error}`);
  return { state: res.state, events: res.events };
}

export function step(state: GameState, pid: PlayerId, action: Action, now = NOW): GameState {
  return act(state, pid, action, now).state;
}

export function refused(state: GameState, pid: PlayerId, action: Action, now = NOW): string {
  const res = applyAction(state, pid, action, { now });
  expect(res.ok).toBe(false);
  return res.ok ? '' : res.error;
}

/** Fait regarder 2 cartes à chacun puis « Prêt » ; p1 commence (starter forcé). */
export function beginTurns(state: GameState): GameState {
  state.starter = state.players.find((p) => p.status === 'active')!.id;
  let s = state;
  for (const p of s.players) {
    if (p.status !== 'active') continue;
    for (const id of p.hand.slice(0, s.config.initialLookCount)) s = step(s, p.id, { type: 'lookInitial', cardId: id });
    s = step(s, p.id, { type: 'ready' });
  }
  return s;
}

export function setup(n: number, spec: RigSpec = {}, config: Partial<GameConfig> = {}): GameState {
  return beginTurns(rig(newGame(n, config), spec));
}

/** Id de la n-ième carte de la main d'un joueur. */
export function cardAt(state: GameState, pid: PlayerId, index: number): string {
  return state.players.find((p) => p.id === pid)!.hand[index];
}

/** Id de la première carte d'un rang donné dans la main d'un joueur. */
export function cardOfRank(state: GameState, pid: PlayerId, rank: string): string {
  const p = state.players.find((x) => x.id === pid)!;
  const id = p.hand.find((h) => state.cards[h].rank === rank);
  if (!id) throw new Error(`${pid} n'a pas de ${rank}`);
  return id;
}

export const CFG = DEFAULT_CONFIG;
