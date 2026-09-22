// CARD SYSTEM : création du paquet, déplacement des cartes entre zones.
import { randomId, shuffleInPlace } from './rng';
import type { Card, CardId, GameState, PlayerId, Pos } from './types';

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Crée la liste complète des cartes (ids opaques, ordre mélangé côté serveur). */
export function buildShuffledDeck(state: GameState): void {
  const { config } = state;
  const cards: Record<CardId, Card> = {};
  const ids: CardId[] = [];
  for (const suit of config.suits) {
    for (const r of config.ranks) {
      let id = randomId(state.idRng);
      while (cards[id]) id = randomId(state.idRng);
      cards[id] = {
        id,
        rank: r.rank,
        suit,
        value: r.value,
        effect: config.effects[r.rank] ?? null,
        location: 'deck',
        owner: null,
        isFaceUp: false,
        pos: null,
      };
      ids.push(id);
    }
  }
  shuffleInPlace(state.rng, ids);
  state.cards = cards;
  state.deck = ids;
  state.discardPile = [];
}

export function topDiscardId(state: GameState): CardId | null {
  return state.discardPile.length ? state.discardPile[state.discardPile.length - 1] : null;
}

export function defaultPosition(index: number, cols: number): Pos {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 30 + col * 40, y: 27 + row * 46 };
}

/** Première position libre du tapis (pour une carte de pénalité). */
export function freePosition(state: GameState, playerId: PlayerId): Pos {
  const player = state.players.find((p) => p.id === playerId)!;
  const taken = player.hand.map((id) => state.cards[id].pos).filter((p): p is Pos => !!p);
  // Point de la grille le plus éloigné des cartes existantes (à égalité : le plus proche du centre).
  let best: Pos = { x: 50, y: 50 };
  let bestGap = -1;
  let bestCenter = Infinity;
  for (let y = 12; y <= 88; y += 12) {
    for (let x = 12; x <= 88; x += 12) {
      const gap = taken.length
        ? Math.min(...taken.map((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y))))
        : 100;
      const center = Math.hypot(x - 50, y - 50);
      if (gap > bestGap || (gap === bestGap && center < bestCenter)) {
        best = { x, y };
        bestGap = gap;
        bestCenter = center;
      }
    }
  }
  return best;
}

function detach(state: GameState, cardId: CardId): void {
  const card = state.cards[cardId];
  if (card.location === 'hand' && card.owner) {
    const p = state.players.find((x) => x.id === card.owner)!;
    p.hand = p.hand.filter((id) => id !== cardId);
  } else if (card.location === 'held') {
    if (state.held?.cardId === cardId) state.held = null;
  } else if (card.location === 'discard') {
    state.discardPile = state.discardPile.filter((id) => id !== cardId);
  } else if (card.location === 'deck') {
    state.deck = state.deck.filter((id) => id !== cardId);
  }
}

export function moveToDiscard(state: GameState, cardId: CardId): void {
  detach(state, cardId);
  const card = state.cards[cardId];
  card.location = 'discard';
  card.owner = null;
  card.isFaceUp = true;
  card.pos = null;
  state.discardPile.push(cardId);
}

export function placeInHand(state: GameState, playerId: PlayerId, cardId: CardId, pos: Pos): void {
  detach(state, cardId);
  const card = state.cards[cardId];
  card.location = 'hand';
  card.owner = playerId;
  card.isFaceUp = false;
  card.pos = { ...pos };
  state.players.find((p) => p.id === playerId)!.hand.push(cardId);
}

export function setHeld(state: GameState, playerId: PlayerId, cardId: CardId): void {
  detach(state, cardId);
  const card = state.cards[cardId];
  card.location = 'held';
  card.owner = playerId;
  card.isFaceUp = false;
  card.pos = null;
  state.held = { playerId, cardId };
}

export function discardCardFromGame(state: GameState, cardId: CardId): void {
  detach(state, cardId);
  const card = state.cards[cardId];
  card.location = 'removed';
  card.owner = null;
  card.isFaceUp = false;
  card.pos = null;
}

export function cardFace(c: Card): { id: CardId; rank: string; suit: Card['suit']; value: number } {
  return { id: c.id, rank: c.rank, suit: c.suit, value: c.value };
}
