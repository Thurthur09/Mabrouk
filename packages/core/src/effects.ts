// Effets de cartes, chacun implémenté séparément et enregistré dans un registre dynamique.
// Pour ajouter un effet : registerEffect({...}) puis l'associer à un rang dans GameConfig.effects.
import { cardFace, placeInHand } from './cards';
import { activePlayers, getPlayer } from './players';
import type { CardId, EffectId, EffectParams, GameEvent, GameState, PlayerId } from './types';

export interface EffectOutcome {
  /** Si défini, le joueur doit regarder cette carte jusqu'à confirmation (phase PEEK). */
  peek?: CardId;
}

export interface EffectDef {
  id: EffectId;
  label: string;
  /** Vrai s'il existe au moins une cible légale. Sinon l'effet est simplement ignoré. */
  isUsable(state: GameState, playerId: PlayerId): boolean;
  /** Retourne un message d'erreur, ou null si les paramètres sont légaux. */
  validate(state: GameState, playerId: PlayerId, params: EffectParams): string | null;
  apply(state: GameState, playerId: PlayerId, params: EffectParams, events: GameEvent[]): EffectOutcome;
}

const EFFECTS: Record<EffectId, EffectDef> = {};

export function registerEffect(def: EffectDef): void {
  EFFECTS[def.id] = def;
}

export function getEffect(id: EffectId | null | undefined): EffectDef | null {
  return id ? (EFFECTS[id] ?? null) : null;
}

function ownHandCard(state: GameState, playerId: PlayerId, cardId: CardId | undefined): string | null {
  if (!cardId) return 'Carte manquante.';
  const p = getPlayer(state, playerId);
  if (!p || !p.hand.includes(cardId)) return 'Cette carte ne fait pas partie de votre tapis.';
  return null;
}

function otherHandCard(
  state: GameState,
  playerId: PlayerId,
  targetPlayerId: PlayerId | undefined,
  cardId: CardId | undefined,
): string | null {
  if (!targetPlayerId || !cardId) return 'Cible manquante.';
  if (targetPlayerId === playerId) return 'Il faut cibler un autre joueur.';
  const t = getPlayer(state, targetPlayerId);
  if (!t || t.status !== 'active') return 'Joueur cible invalide.';
  if (!t.hand.includes(cardId)) return 'Cette carte ne fait pas partie du tapis de la cible.';
  return null;
}

function othersHaveCards(state: GameState, playerId: PlayerId): boolean {
  return activePlayers(state).some((p) => p.id !== playerId && p.hand.length > 0);
}

registerEffect({
  id: 'peekOwn',
  label: 'Regarder une de vos cartes',
  isUsable: (s, pid) => (getPlayer(s, pid)?.hand.length ?? 0) > 0,
  validate: (s, pid, p) => ownHandCard(s, pid, p.cardId ?? p.ownCardId),
  apply(s, pid, p, events) {
    const cardId = (p.cardId ?? p.ownCardId)!;
    events.push({ to: 'all', type: 'peekStart', data: { playerId: pid, cardId, kind: 'own' } });
    events.push({ to: [pid], type: 'peek', data: { playerId: pid, card: cardFace(s.cards[cardId]) } });
    return { peek: cardId };
  },
});

registerEffect({
  id: 'peekOther',
  label: 'Regarder une carte adverse',
  isUsable: (s, pid) => othersHaveCards(s, pid),
  validate: (s, pid, p) => otherHandCard(s, pid, p.targetPlayerId, p.targetCardId ?? p.cardId),
  apply(s, pid, p, events) {
    const cardId = (p.targetCardId ?? p.cardId)!;
    events.push({
      to: 'all',
      type: 'peekStart',
      data: { playerId: pid, cardId, kind: 'other', targetPlayerId: p.targetPlayerId },
    });
    events.push({ to: [pid], type: 'peek', data: { playerId: pid, card: cardFace(s.cards[cardId]) } });
    return { peek: cardId };
  },
});

registerEffect({
  id: 'swapBlind',
  label: 'Échanger une carte (à l\'aveugle) avec un autre joueur',
  isUsable: (s, pid) => (getPlayer(s, pid)?.hand.length ?? 0) > 0 && othersHaveCards(s, pid),
  validate: (s, pid, p) =>
    ownHandCard(s, pid, p.ownCardId) ?? otherHandCard(s, pid, p.targetPlayerId, p.targetCardId),
  apply(s, pid, p, events) {
    const mine = p.ownCardId!;
    const theirs = p.targetCardId!;
    const target = p.targetPlayerId!;
    const myPos = s.cards[mine].pos ?? { x: 50, y: 50 };
    const theirPos = s.cards[theirs].pos ?? { x: 50, y: 50 };
    placeInHand(s, target, mine, theirPos);
    placeInHand(s, pid, theirs, myPos);
    events.push({
      to: 'all',
      type: 'swap',
      data: { playerId: pid, ownCardId: mine, targetPlayerId: target, targetCardId: theirs },
    });
    return {};
  },
});
