// Vues filtrées : ce que CHAQUE joueur a le droit de connaître. Seule cette structure quitte le serveur.
import { getAvailableActions } from './engine';
import { getEffect } from './effects';
import { rank } from './scoring';
import type {
  AvailableActions,
  CardId,
  EffectId,
  FinalLap,
  Phase,
  PlayerId,
  Pos,
  RankEntry,
  RoundResult,
  Suit,
} from './types';
import type { GameState } from './types';

export interface FaceView {
  rank: string;
  suit: Suit;
  value: number;
}

export interface CardView {
  id: CardId;
  pos: Pos;
  /** null = carte cachée pour ce joueur. */
  face: FaceView | null;
  /** Mauvaise défausse signalée en rouge (visible par tous jusqu'à `redUntil`). */
  redUntil: number | null;
}

export interface PlayerGameView {
  id: PlayerId;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  status: 'active' | 'removed';
  score: number;
  roundScore: number | null;
  ready: boolean;
  cardCount: number;
  hand: CardView[];
}

export interface GameView {
  me: PlayerId;
  phase: Phase;
  round: number;
  targetScore: number;
  currentPlayer: PlayerId | null;
  starter: PlayerId | null;
  players: PlayerGameView[];
  deckCount: number;
  discardCount: number;
  discardTop: (FaceView & { id: CardId }) | null;
  /** Carte piochée en main : la valeur n'est visible que par son porteur. */
  held: { playerId: PlayerId; cardId: CardId; face: FaceView | null } | null;
  pendingEffect: { playerId: PlayerId; effect: EffectId; label: string; cardId: CardId } | null;
  peek: { playerId: PlayerId; cardId: CardId; face: FaceView | null } | null;
  /** Cartes que j'ai regardées au début de la manche (tant que je ne suis pas prêt). */
  initialLookCount: number;
  initialLookNeeded: number;
  finalLap: FinalLap | null;
  available: AvailableActions;
  ranking: RankEntry[];
  lastRound: RoundResult | null;
  winners: PlayerId[] | null;
  effects: Record<string, EffectId>;
  seq: number;
}

function face(c: { rank: string; suit: Suit; value: number }): FaceView {
  return { rank: c.rank, suit: c.suit, value: c.value };
}

export function getPlayerView(state: GameState, viewerId: PlayerId, now: number): GameView {
  const revealAll = state.phase === 'ROUND_END' || state.phase === 'GAME_END';
  const redUntil = new Map<CardId, number>();
  for (const r of state.reveals) if (r.until > now) redUntil.set(r.cardId, r.until);
  const looked = new Set(state.initialLook[viewerId] ?? []);

  const canSee = (cardId: CardId, ownerId: PlayerId): boolean => {
    if (revealAll) return true;
    if (redUntil.has(cardId)) return true;
    if (ownerId === viewerId && state.phase === 'INITIAL_LOOK' && looked.has(cardId) && !state.ready.includes(viewerId)) {
      return true;
    }
    if (state.peek && state.peek.playerId === viewerId && state.peek.cardId === cardId) return true;
    return false;
  };

  const players = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    color: p.color,
    isBot: p.isBot,
    status: p.status,
    score: p.score,
    roundScore: p.roundScore,
    ready: state.ready.includes(p.id),
    cardCount: p.hand.length,
    hand: p.hand.map((id): CardView => {
      const c = state.cards[id];
      return {
        id,
        pos: c.pos ?? { x: 50, y: 50 },
        face: canSee(id, p.id) ? face(c) : null,
        redUntil: redUntil.get(id) ?? null,
      };
    }),
  }));

  const topId = state.discardPile.length ? state.discardPile[state.discardPile.length - 1] : null;
  const top = topId ? state.cards[topId] : null;

  const heldCard = state.held ? state.cards[state.held.cardId] : null;
  const peekCard = state.peek ? state.cards[state.peek.cardId] : null;
  const pe = state.pendingEffect;

  const active = state.players.filter((p) => p.status === 'active');
  const me = state.players.find((p) => p.id === viewerId);
  const lastRound = state.history.length ? state.history[state.history.length - 1] : null;

  return {
    me: viewerId,
    phase: state.phase,
    round: state.round,
    targetScore: state.config.targetScore,
    currentPlayer: state.currentPlayer,
    starter: state.starter,
    players,
    deckCount: state.deck.length,
    discardCount: state.discardPile.length,
    discardTop: top ? { id: top.id, ...face(top) } : null,
    held:
      state.held && heldCard
        ? {
            playerId: state.held.playerId,
            cardId: state.held.cardId,
            face: state.held.playerId === viewerId ? face(heldCard) : null,
          }
        : null,
    pendingEffect: pe
      ? { playerId: pe.playerId, effect: pe.effect, label: getEffect(pe.effect)?.label ?? pe.effect, cardId: pe.cardId }
      : null,
    peek:
      state.peek && peekCard
        ? {
            playerId: state.peek.playerId,
            cardId: state.peek.cardId,
            face: state.peek.playerId === viewerId ? face(peekCard) : null,
          }
        : null,
    initialLookCount: (state.initialLook[viewerId] ?? []).length,
    initialLookNeeded: me ? Math.min(state.config.initialLookCount, me.hand.length) : 0,
    finalLap: state.finalLap,
    available: getAvailableActions(state, viewerId),
    ranking: rank(active.map((p) => ({ playerId: p.id, score: p.score }))),
    lastRound,
    winners: state.winners,
    effects: state.config.effects,
    seq: state.seq,
  };
}
