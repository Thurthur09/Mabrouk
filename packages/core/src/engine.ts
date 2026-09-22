// GAME ENGINE : toutes les règles du jeu. Aucune dépendance à l'UI, au réseau ni à l'horloge
// (le temps est injecté via ActionContext). Déterministe pour une graine donnée.
//
// Machine à états (state.phase) :
//   [createGame] -> DEALING (instantané) -> INITIAL_LOOK
//   INITIAL_LOOK --tous prêts--> TURN_START
//   TURN_START --takeDiscard--> AWAIT_DRAW --draw--> HOLDING
//   TURN_START --draw--> HOLDING
//   TURN_START --callMabrouk--> (tour passé) -> tour suivant
//   HOLDING --swapHeld--> fin de tour
//   HOLDING --discardHeld--> EFFECT (si effet utilisable) | fin de tour
//   EFFECT --useEffect--> PEEK (8/9) | fin de tour (7)   ;   EFFECT --skipEffect--> fin de tour
//   PEEK --confirmPeek--> fin de tour
//   fin de tour -> CHECK_END (dernier tour atteint ?) -> TURN_START | ROUND_END
//   ROUND_END --tous prêts--> INITIAL_LOOK (manche suivante) ; ROUND_END -> GAME_END si seuil atteint
import {
  buildShuffledDeck,
  cardFace,
  clone,
  defaultPosition,
  discardCardFromGame,
  freePosition,
  moveToDiscard,
  placeInHand,
  setHeld,
  topDiscardId,
} from './cards';
import { getEffect } from './effects';
import { activePlayers, getPlayer, isActive, nextActiveAfter } from './players';
import { makeRng, next, nextInt, pick, shuffleInPlace } from './rng';
import { adjustMabrouk, calculateScore, rank } from './scoring';
import type {
  Action,
  ActionContext,
  ActionResult,
  AvailableActions,
  GameConfig,
  GameEvent,
  GameState,
  Phase,
  PlayerId,
  RoundEndReason,
  RoundResult,
} from './types';

export interface PlayerInput {
  id: PlayerId;
  name: string;
  avatar?: string;
  color?: string;
  isBot?: boolean;
}

export const PLAYING_PHASES: Phase[] = ['TURN_START', 'AWAIT_DRAW', 'HOLDING', 'EFFECT', 'PEEK'];

export function isPlayingPhase(phase: Phase): boolean {
  return PLAYING_PHASES.includes(phase);
}

// ---------------------------------------------------------------- Création

/** `seed` : au moins 8 entiers 32 bits (4 pour le mélange, 4 pour les identifiants de cartes). */
export function createGame(config: GameConfig, inputs: PlayerInput[], seed: number[]): GameState {
  if (inputs.length < config.minPlayers || inputs.length > config.maxPlayers) {
    throw new Error(`Il faut entre ${config.minPlayers} et ${config.maxPlayers} joueurs.`);
  }
  if (new Set(inputs.map((i) => i.id)).size !== inputs.length) throw new Error('Identifiants de joueurs en double.');
  if (!(config.targetScore > 0)) throw new Error('Le seuil de fin de partie doit être positif.');
  if (seed.length < 8) throw new Error('Graine insuffisante.');

  const state: GameState = {
    config: clone(config),
    players: inputs.map((i) => ({
      id: i.id,
      name: i.name,
      avatar: i.avatar ?? '🙂',
      color: i.color ?? '#7c9cff',
      isBot: !!i.isBot,
      hand: [],
      score: 0,
      roundScore: null,
      status: 'active' as const,
    })),
    cards: {},
    deck: [],
    discardPile: [],
    currentPlayer: null,
    round: 0,
    phase: 'INITIAL_LOOK',
    held: null,
    pendingEffect: null,
    peek: null,
    initialLook: {},
    ready: [],
    finalLap: null,
    reveals: [],
    starter: null,
    nextStarter: null,
    history: [],
    winners: null,
    seq: 0,
    rng: makeRng(seed.slice(0, 4)),
    idRng: makeRng(seed.slice(4, 8)),
  };
  startRound(state, []);
  return state;
}

/** DEALING + ROUND_START : nouveau paquet, distribution, première carte de défausse. */
function startRound(state: GameState, events: GameEvent[]): void {
  state.round += 1;
  buildShuffledDeck(state);
  state.held = null;
  state.pendingEffect = null;
  state.peek = null;
  state.reveals = [];
  state.finalLap = null;
  state.ready = [];
  state.initialLook = {};
  state.currentPlayer = null;
  for (const p of state.players) {
    p.hand = [];
    p.roundScore = null;
  }
  const actives = activePlayers(state);
  for (let i = 0; i < state.config.handSize; i++) {
    for (const p of actives) {
      const id = state.deck.pop()!;
      placeInHand(state, p.id, id, defaultPosition(i, state.config.gridColumns));
    }
  }
  moveToDiscard(state, state.deck.pop()!); // on retourne la première carte de la défausse

  if (state.round === 1 || !state.nextStarter) {
    state.starter = pick(state.rng, actives).id;
  } else if (isActive(state, state.nextStarter)) {
    state.starter = state.nextStarter;
  } else {
    state.starter = nextActiveAfter(state, state.nextStarter)?.id ?? actives[0].id;
  }
  state.phase = 'INITIAL_LOOK';
  events.push({ to: 'all', type: 'roundStart', data: { round: state.round, starter: state.starter } });
}

// ---------------------------------------------------------------- Validation

function errNotYourTurn(state: GameState, pid: PlayerId): string | null {
  return state.currentPlayer === pid ? null : "Ce n'est pas votre tour.";
}

/** Retourne un message d'erreur si l'action est illégale, sinon null. Ne modifie rien. */
export function validateAction(state: GameState, pid: PlayerId, action: Action): string | null {
  const player = getPlayer(state, pid);
  if (!player || player.status !== 'active') return 'Joueur inconnu ou exclu.';
  if (!action || typeof (action as { type?: unknown }).type !== 'string') return 'Action invalide.';
  const hasCard = (id: unknown) => typeof id === 'string' && player.hand.includes(id);

  switch (action.type) {
    case 'lookInitial': {
      if (state.phase !== 'INITIAL_LOOK') return 'Ce n\'est pas le moment de regarder vos cartes.';
      if (state.ready.includes(pid)) return 'Vous êtes déjà prêt.';
      if (!hasCard(action.cardId)) return 'Cette carte ne fait pas partie de votre tapis.';
      const looked = state.initialLook[pid] ?? [];
      if (looked.includes(action.cardId)) return 'Carte déjà regardée.';
      if (looked.length >= state.config.initialLookCount) return 'Vous avez déjà regardé le nombre de cartes autorisé.';
      return null;
    }
    case 'ready': {
      if (state.phase !== 'INITIAL_LOOK') return "Ce n'est pas le moment.";
      if (state.ready.includes(pid)) return 'Vous êtes déjà prêt.';
      const need = Math.min(state.config.initialLookCount, player.hand.length);
      if ((state.initialLook[pid] ?? []).length < need) return `Regardez d'abord ${need} de vos cartes.`;
      return null;
    }
    case 'callMabrouk':
      if (state.phase !== 'TURN_START') return 'Mabrouk ne peut être annoncé qu\'au début de votre tour, avant toute action.';
      if (state.finalLap) return 'Un Mabrouk est déjà en cours : la première annonce compte.';
      return errNotYourTurn(state, pid);
    case 'takeDiscard':
      if (state.phase !== 'TURN_START') return "L'échange avec la défausse se fait au début du tour.";
      if (errNotYourTurn(state, pid)) return errNotYourTurn(state, pid);
      if (!state.discardPile.length) return 'La défausse est vide.';
      if (!hasCard(action.cardId)) return 'Cette carte ne fait pas partie de votre tapis.';
      return null;
    case 'draw':
      if (state.phase !== 'TURN_START' && state.phase !== 'AWAIT_DRAW') return 'Vous ne pouvez pas piocher maintenant.';
      return errNotYourTurn(state, pid);
    case 'swapHeld':
      if (state.phase !== 'HOLDING' || !state.held) return "Vous n'avez pas de carte piochée.";
      if (errNotYourTurn(state, pid)) return errNotYourTurn(state, pid);
      if (!hasCard(action.cardId)) return 'Cette carte ne fait pas partie de votre tapis.';
      return null;
    case 'discardHeld':
      if (state.phase !== 'HOLDING' || !state.held) return "Vous n'avez pas de carte piochée.";
      return errNotYourTurn(state, pid);
    case 'useEffect': {
      if (state.phase !== 'EFFECT' || !state.pendingEffect) return 'Aucun effet à résoudre.';
      if (errNotYourTurn(state, pid)) return errNotYourTurn(state, pid);
      const def = getEffect(state.pendingEffect.effect);
      if (!def) return 'Effet inconnu.';
      if (!action.params || typeof action.params !== 'object') return 'Paramètres manquants.';
      return def.validate(state, pid, action.params);
    }
    case 'skipEffect':
      if (state.phase !== 'EFFECT' || !state.pendingEffect) return 'Aucun effet à résoudre.';
      return errNotYourTurn(state, pid);
    case 'confirmPeek':
      if (state.phase !== 'PEEK' || state.peek?.playerId !== pid) return 'Rien à confirmer.';
      return null;
    case 'matchDiscard':
      if (!isPlayingPhase(state.phase)) return 'La manche n\'est pas en cours.';
      if (!state.discardPile.length) return 'La défausse est vide.';
      if (!hasCard(action.cardId)) return 'Cette carte ne fait pas partie de votre tapis.';
      return null;
    case 'moveCard':
      if (state.phase !== 'INITIAL_LOOK' && !isPlayingPhase(state.phase)) return 'Déplacement impossible maintenant.';
      if (!hasCard(action.cardId)) return 'Cette carte ne fait pas partie de votre tapis.';
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return 'Position invalide.';
      return null;
    case 'nextRound':
      if (state.phase !== 'ROUND_END') return "La manche n'est pas terminée.";
      if (state.ready.includes(pid)) return 'Vous êtes déjà prêt.';
      return null;
    default:
      return 'Action inconnue.';
  }
}

/** Actions actuellement légales pour ce joueur (l'UI s'en sert, le serveur revérifie toujours). */
export function getAvailableActions(state: GameState, pid: PlayerId): AvailableActions {
  const player = getPlayer(state, pid);
  const first = player?.hand[0] ?? '';
  const unlooked = player?.hand.find((id) => !(state.initialLook[pid] ?? []).includes(id)) ?? '';
  const ok = (a: Action) => validateAction(state, pid, a) === null;
  let canUseEffect: string | null = null;
  if (state.phase === 'EFFECT' && state.currentPlayer === pid && state.pendingEffect) {
    const def = getEffect(state.pendingEffect.effect);
    if (def && def.isUsable(state, pid)) canUseEffect = def.id;
  }
  return {
    canLookInitial: ok({ type: 'lookInitial', cardId: unlooked }),
    canReady: ok({ type: 'ready' }),
    canCallMabrouk: ok({ type: 'callMabrouk' }),
    canTakeDiscard: ok({ type: 'takeDiscard', cardId: first }),
    canDraw: ok({ type: 'draw' }),
    canSwapHeld: ok({ type: 'swapHeld', cardId: first }),
    canDiscardHeld: ok({ type: 'discardHeld' }),
    canUseEffect,
    canSkipEffect: ok({ type: 'skipEffect' }),
    canConfirmPeek: ok({ type: 'confirmPeek' }),
    canMatchDiscard: ok({ type: 'matchDiscard', cardId: first }),
    canMoveCards: ok({ type: 'moveCard', cardId: first, x: 50, y: 50 }),
    canNextRound: ok({ type: 'nextRound' }),
  };
}

// ---------------------------------------------------------------- Exécution

/** Point d'entrée unique : valide côté moteur puis applique sur une copie (atomique). */
export function applyAction(prev: GameState, pid: PlayerId, action: Action, ctx: ActionContext): ActionResult {
  const error = validateAction(prev, pid, action);
  if (error) return { ok: false, error };
  const state = clone(prev);
  const events: GameEvent[] = [];
  execute(state, pid, action, ctx, events);
  state.reveals = state.reveals.filter((r) => r.until > ctx.now);
  state.seq += 1;
  return { ok: true, state, events };
}

function execute(state: GameState, pid: PlayerId, action: Action, ctx: ActionContext, events: GameEvent[]): void {
  const player = getPlayer(state, pid)!;
  switch (action.type) {
    case 'lookInitial': {
      (state.initialLook[pid] ??= []).push(action.cardId);
      events.push({ to: [pid], type: 'initialLook', data: { card: cardFace(state.cards[action.cardId]) } });
      return;
    }
    case 'ready': {
      state.ready.push(pid);
      events.push({ to: 'all', type: 'playerReady', data: { playerId: pid } });
      if (activePlayers(state).every((p) => state.ready.includes(p.id))) beginPlay(state, events);
      return;
    }
    case 'callMabrouk': {
      state.finalLap = { trigger: pid, reason: 'mabrouk' };
      events.push({ to: 'all', type: 'mabrouk', data: { playerId: pid, auto: false } });
      advanceTurn(state, events);
      return;
    }
    case 'takeDiscard': {
      const topId = topDiscardId(state)!;
      const mine = state.cards[action.cardId];
      const pos = mine.pos ?? freePosition(state, pid);
      placeInHand(state, pid, topId, pos); // la carte de défausse rejoint mon tapis (face cachée)
      moveToDiscard(state, mine.id); // ma carte part face visible
      events.push({
        to: 'all',
        type: 'takeDiscard',
        data: { playerId: pid, takenCardId: topId, placed: cardFace(mine), takenFace: cardFace(state.cards[topId]) },
      });
      state.phase = 'AWAIT_DRAW';
      return;
    }
    case 'draw': {
      const id = drawFromDeck(state, events);
      if (id === null) return; // pioche épuisée : la manche vient de se terminer
      setHeld(state, pid, id);
      state.phase = 'HOLDING';
      events.push({ to: 'all', type: 'draw', data: { playerId: pid, cardId: id } });
      events.push({ to: [pid], type: 'drawPrivate', data: { card: cardFace(state.cards[id]) } });
      return;
    }
    case 'swapHeld': {
      const held = state.cards[state.held!.cardId];
      const mine = state.cards[action.cardId];
      const pos = mine.pos ?? freePosition(state, pid);
      moveToDiscard(state, mine.id); // ma carte remplacée part face visible, sans effet
      placeInHand(state, pid, held.id, pos);
      events.push({
        to: 'all',
        type: 'swapHeld',
        data: { playerId: pid, placedCardId: held.id, discarded: cardFace(mine) },
      });
      advanceTurn(state, events);
      return;
    }
    case 'discardHeld': {
      const held = state.cards[state.held!.cardId];
      moveToDiscard(state, held.id);
      events.push({ to: 'all', type: 'discardHeld', data: { playerId: pid, card: cardFace(held) } });
      const def = getEffect(held.effect);
      if (def && def.isUsable(state, pid)) {
        state.pendingEffect = { playerId: pid, effect: def.id, cardId: held.id };
        state.phase = 'EFFECT';
        events.push({ to: 'all', type: 'effectPrompt', data: { playerId: pid, effect: def.id, cardId: held.id } });
      } else {
        advanceTurn(state, events);
      }
      return;
    }
    case 'useEffect': {
      const def = getEffect(state.pendingEffect!.effect)!;
      state.pendingEffect = null;
      const out = def.apply(state, pid, action.params, events);
      if (out.peek) {
        state.peek = { playerId: pid, cardId: out.peek };
        state.phase = 'PEEK';
      } else {
        advanceTurn(state, events);
      }
      return;
    }
    case 'skipEffect': {
      events.push({ to: 'all', type: 'effectSkipped', data: { playerId: pid } });
      advanceTurn(state, events);
      return;
    }
    case 'confirmPeek': {
      advanceTurn(state, events);
      return;
    }
    case 'matchDiscard': {
      const card = state.cards[action.cardId];
      const top = state.cards[topDiscardId(state)!];
      if (card.value === top.value) {
        moveToDiscard(state, card.id); // pas d'effet pour une défausse hors tour
        events.push({ to: 'all', type: 'matchOk', data: { playerId: pid, card: cardFace(card) } });
        if (player.hand.length === 0 && !state.finalLap) {
          state.finalLap = { trigger: pid, reason: 'emptyHand' };
          events.push({ to: 'all', type: 'mabrouk', data: { playerId: pid, auto: true } });
        }
      } else {
        const until = ctx.now + state.config.penaltyRevealMs;
        state.reveals.push({ cardId: card.id, until });
        events.push({
          to: 'all',
          type: 'matchFail',
          data: { playerId: pid, card: cardFace(card), until },
        });
        if (!ensureDeck(state, events)) {
          endRound(state, 'deckExhausted', events);
          return;
        }
        const cid = state.deck.pop()!;
        placeInHand(state, pid, cid, freePosition(state, pid)); // pénalité : carte face cachée
        events.push({ to: 'all', type: 'penaltyDraw', data: { playerId: pid, cardId: cid } });
      }
      return;
    }
    case 'moveCard': {
      const c = state.cards[action.cardId];
      c.pos = { x: Math.min(100, Math.max(0, action.x)), y: Math.min(100, Math.max(0, action.y)) };
      events.push({ to: 'all', type: 'cardMoved', data: { playerId: pid, cardId: c.id, pos: c.pos } });
      return;
    }
    case 'nextRound': {
      state.ready.push(pid);
      events.push({ to: 'all', type: 'playerReady', data: { playerId: pid } });
      if (activePlayers(state).every((p) => state.ready.includes(p.id))) startRound(state, events);
      return;
    }
  }
}

function beginPlay(state: GameState, events: GameEvent[]): void {
  state.ready = [];
  state.phase = 'TURN_START';
  state.currentPlayer = state.starter;
  events.push({ to: 'all', type: 'turn', data: { playerId: state.currentPlayer } });
}

// ---------------------------------------------------------------- Pioche

/** Garantit une pioche non vide (remélange de la défausse, sa dernière carte reste). */
function ensureDeck(state: GameState, events: GameEvent[]): boolean {
  if (state.deck.length > 0) return true;
  if (state.discardPile.length >= 2) {
    const top = state.discardPile[state.discardPile.length - 1];
    const rest = state.discardPile.slice(0, -1);
    for (const id of rest) {
      const c = state.cards[id];
      c.location = 'deck';
      c.isFaceUp = false;
      c.owner = null;
    }
    shuffleInPlace(state.rng, rest);
    state.deck = rest;
    state.discardPile = [top];
    events.push({ to: 'all', type: 'reshuffle', data: { count: rest.length } });
    return true;
  }
  return false;
}

/** Retourne l'id de la carte piochée, ou null si la manche s'est terminée faute de cartes. */
function drawFromDeck(state: GameState, events: GameEvent[]): string | null {
  if (!ensureDeck(state, events)) {
    endRound(state, 'deckExhausted', events);
    return null;
  }
  return state.deck.pop()!;
}

// ---------------------------------------------------------------- Tour suivant / fin de manche

/** NEXT_PLAYER + CHECK_END : passe au joueur suivant (sens horaire) ou termine la manche. */
function advanceTurn(state: GameState, events: GameEvent[]): void {
  state.held = null;
  state.pendingEffect = null;
  state.peek = null;
  const n = state.players.length;
  let idx = state.players.findIndex((p) => p.id === state.currentPlayer);
  for (let i = 0; i < n; i++) {
    idx = (idx + 1) % n;
    const cand = state.players[idx];
    if (state.finalLap && cand.id === state.finalLap.trigger) {
      endRound(state, state.finalLap.reason, events);
      return;
    }
    if (cand.status !== 'active') continue;
    state.currentPlayer = cand.id;
    state.phase = 'TURN_START';
    events.push({ to: 'all', type: 'turn', data: { playerId: cand.id } });
    return;
  }
  finishGame(state, events);
}

function finishGame(state: GameState, events: GameEvent[]): void {
  const actives = activePlayers(state);
  const ranking = rank(actives.map((p) => ({ playerId: p.id, score: p.score })));
  state.phase = 'GAME_END';
  state.currentPlayer = null;
  state.winners = ranking.filter((r) => r.rank === 1).map((r) => r.playerId);
  events.push({ to: 'all', type: 'gameEnd', data: { winners: state.winners } });
}

/** ROUND_END + SCORING : révèle les tapis, calcule scores, bonus/pénalités, classements. */
function endRound(state: GameState, reason: RoundEndReason, events: GameEvent[]): void {
  const actives = activePlayers(state);
  const raw: Record<PlayerId, number> = {};
  for (const p of actives) raw[p.id] = calculateScore(state, p.id);
  const roundScores: Record<PlayerId, number> = { ...raw };

  let outcome: RoundResult['mabroukOutcome'] = null;
  let gap = 0;
  const trigger = state.finalLap?.trigger ?? null;
  // Bonus/malus uniquement pour un Mabrouk volontaire (jamais pour une main vide ni pioche épuisée).
  if (reason === 'mabrouk' && trigger && isActive(state, trigger)) {
    const others = actives.filter((p) => p.id !== trigger).map((p) => raw[p.id]);
    const adj = adjustMabrouk(raw[trigger], others);
    roundScores[trigger] = adj.roundScore;
    outcome = adj.outcome;
    gap = adj.gap;
  }

  const hands: RoundResult['hands'] = {};
  for (const p of actives) {
    p.roundScore = roundScores[p.id];
    p.score += roundScores[p.id];
    hands[p.id] = p.hand.map((id) => cardFace(state.cards[id]));
    for (const id of p.hand) state.cards[id].isFaceUp = true;
  }

  const roundRanking = rank(actives.map((p) => ({ playerId: p.id, score: roundScores[p.id] })));
  const globalRanking = rank(actives.map((p) => ({ playerId: p.id, score: p.score })));
  const worst = Math.max(...actives.map((p) => roundScores[p.id]));
  const losers = actives.filter((p) => roundScores[p.id] === worst);
  const nextStarter = losers.length === 1 ? losers[0].id : losers[nextInt(state.rng, losers.length)].id;
  next(state.rng); // avance l'état pour ne pas rejouer la même valeur

  const totals: Record<PlayerId, number> = {};
  for (const p of actives) totals[p.id] = p.score;
  const result: RoundResult = {
    round: state.round,
    reason,
    trigger,
    mabroukOutcome: outcome,
    penaltyGap: gap,
    raw,
    roundScores,
    totals,
    roundRanking,
    globalRanking,
    hands,
    nextStarter,
  };
  state.history.push(result);
  state.nextStarter = nextStarter;
  state.held = null;
  state.pendingEffect = null;
  state.peek = null;
  state.currentPlayer = null;
  state.ready = [];
  state.phase = 'ROUND_END';
  events.push({ to: 'all', type: 'roundEnd', data: { result } });

  if (actives.some((p) => p.score >= state.config.targetScore)) {
    state.winners = globalRanking.filter((r) => r.rank === 1).map((r) => r.playerId);
    state.phase = 'GAME_END';
    events.push({ to: 'all', type: 'gameEnd', data: { winners: state.winners } });
  }
}

// ---------------------------------------------------------------- Exclusion

/** Retire un joueur de la partie (vote d'exclusion) : ses cartes sont écartées du jeu. */
export function removePlayer(prev: GameState, pid: PlayerId, ctx: ActionContext): ActionResult {
  const player = getPlayer(prev, pid);
  if (!player || player.status !== 'active') return { ok: false, error: 'Joueur inconnu ou déjà exclu.' };
  const state = clone(prev);
  const events: GameEvent[] = [];
  const p = getPlayer(state, pid)!;
  const wasCurrent = state.currentPlayer === pid;

  for (const id of [...p.hand]) discardCardFromGame(state, id);
  if (state.held?.playerId === pid) discardCardFromGame(state, state.held.cardId);
  p.status = 'removed';
  if (state.peek?.playerId === pid) state.peek = null;
  if (state.pendingEffect?.playerId === pid) state.pendingEffect = null;
  state.ready = state.ready.filter((id) => id !== pid);
  delete state.initialLook[pid];
  events.push({ to: 'all', type: 'playerRemoved', data: { playerId: pid } });

  const actives = activePlayers(state);
  if (actives.length < 2) {
    finishGame(state, events);
  } else if (state.phase === 'INITIAL_LOOK') {
    if (actives.every((a) => state.ready.includes(a.id))) beginPlay(state, events);
  } else if (state.phase === 'ROUND_END') {
    if (actives.every((a) => state.ready.includes(a.id))) startRound(state, events);
  } else if (isPlayingPhase(state.phase) && wasCurrent) {
    advanceTurn(state, events);
  }
  state.reveals = state.reveals.filter((r) => r.until > ctx.now);
  state.seq += 1;
  return { ok: true, state, events };
}
