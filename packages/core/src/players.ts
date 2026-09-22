// PLAYER SYSTEM
import type { GameState, Player, PlayerId } from './types';

export function getPlayer(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => p.status === 'active');
}

export function isActive(state: GameState, id: PlayerId): boolean {
  return getPlayer(state, id)?.status === 'active';
}

/** Prochain joueur actif dans le sens horaire (ordre du tableau), en partant de `fromId` exclu. */
export function nextActiveAfter(state: GameState, fromId: PlayerId): Player | null {
  const n = state.players.length;
  const start = state.players.findIndex((p) => p.id === fromId);
  for (let i = 1; i <= n; i++) {
    const p = state.players[(start + i) % n];
    if (p.status === 'active') return p;
  }
  return null;
}
