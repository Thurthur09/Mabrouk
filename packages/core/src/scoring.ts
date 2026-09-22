// SCORING SYSTEM : tout le calcul des points est ici (jamais dans l'interface).
import type { GameState, PlayerId, RankEntry } from './types';

/**
 * Score brut d'un tapis : valeur de chaque carte restante + 1 point par carte restante.
 * Les cartes en main (carte piochée non posée) ne font pas partie du tapis.
 */
export function calculateScore(state: GameState, playerId: PlayerId): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  let total = 0;
  for (const id of player.hand) total += state.cards[id].value + 1;
  return total;
}

/** Classement « à égalité, même rang » (1, 1, 3, …). Le score le plus bas est premier. */
export function rank(entries: { playerId: PlayerId; score: number }[]): RankEntry[] {
  const sorted = [...entries].sort((a, b) => a.score - b.score);
  const out: RankEntry[] = [];
  sorted.forEach((e, i) => {
    const rankNo = i > 0 && sorted[i - 1].score === e.score ? out[i - 1].rank : i + 1;
    out.push({ playerId: e.playerId, score: e.score, rank: rankNo });
  });
  return out;
}

export interface MabroukAdjustment {
  roundScore: number;
  outcome: 'won' | 'penalty';
  gap: number;
}

/**
 * Mabrouk volontaire :
 *  - strictement meilleur que tous les autres -> 0 pour la manche ;
 *  - sinon -> son score + l'écart avec le meilleur (ex. 3 contre 1 : 3 + 2 = 5).
 */
export function adjustMabrouk(callerRaw: number, othersRaw: number[]): MabroukAdjustment {
  if (othersRaw.length === 0) return { roundScore: 0, outcome: 'won', gap: 0 };
  const best = Math.min(...othersRaw);
  if (callerRaw < best) return { roundScore: 0, outcome: 'won', gap: 0 };
  const gap = callerRaw - best;
  return { roundScore: callerRaw + gap, outcome: 'penalty', gap };
}
