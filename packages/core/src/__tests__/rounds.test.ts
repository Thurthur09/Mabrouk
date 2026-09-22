import { describe, expect, it } from 'vitest';
import { getAvailableActions, removePlayer } from '../engine';
import { makeRng } from '../rng';
import { adjustMabrouk, calculateScore, rank } from '../scoring';
import type { GameEvent, GameState } from '../types';
import { getPlayerView } from '../views';
import { NOW, SEED, act, cardAt, newGame, refused, setup, step } from './helpers';

/** Le joueur actif pioche puis défausse directement (les Rois piochés n'ont pas d'effet). */
function passTurn(s: GameState): GameState {
  const cur = s.currentPlayer!;
  s = step(s, cur, { type: 'draw' });
  return step(s, cur, { type: 'discardHeld' });
}

const HANDS3 = { p1: ['2', '3', '4', '5'], p2: ['6', 'A', 'K', '9'], p3: ['2', '3', 'A', '5'] };

describe('calculateScore', () => {
  it('somme des valeurs + 1 point par carte restante', () => {
    const s = setup(2, { hands: { p1: ['K', 'K', 'A', '9'], p2: ['5'] } });
    expect(calculateScore(s, 'p1')).toBe(1 + 1 + 2 + 10);
    expect(calculateScore(s, 'p2')).toBe(6);
  });
  it('un tapis vide vaut 0, le Roi vaut 0 + 1 point de carte', () => {
    const s = setup(3, { hands: { p1: ['K'], p2: ['K', 'K'], p3: [] } });
    expect(calculateScore(s, 'p1')).toBe(1);
    expect(calculateScore(s, 'p2')).toBe(2);
    expect(calculateScore(s, 'p3')).toBe(0);
  });
  it('ignore la carte piochée pas encore posée', () => {
    let s = setup(2, { hands: { p1: ['2', '2', '2', '2'], p2: ['K', 'K', 'K', 'K'] }, deck: ['9'] });
    s = step(s, 'p1', { type: 'draw' });
    expect(calculateScore(s, 'p1')).toBe(12);
  });
  it('un joueur inconnu vaut 0', () => {
    expect(calculateScore(newGame(2), 'nobody')).toBe(0);
  });
});

describe('classement et ajustement Mabrouk', () => {
  it('égalité = même rang (1, 1, 3)', () => {
    const r = rank([
      { playerId: 'a', score: 7 },
      { playerId: 'b', score: 5 },
      { playerId: 'c', score: 5 },
    ]);
    expect(r.map((x) => [x.playerId, x.rank])).toEqual([
      ['b', 1],
      ['c', 1],
      ['a', 3],
    ]);
  });
  it('Mabrouk : strictement meilleur => 0 ; sinon score + écart', () => {
    expect(adjustMabrouk(3, [10, 20])).toEqual({ roundScore: 0, outcome: 'won', gap: 0 });
    expect(adjustMabrouk(3, [1, 20])).toEqual({ roundScore: 5, outcome: 'penalty', gap: 2 }); // exemple de la règle
    expect(adjustMabrouk(3, [3, 9])).toEqual({ roundScore: 3, outcome: 'penalty', gap: 0 }); // égalité : ne gagne pas
    expect(adjustMabrouk(4, [])).toEqual({ roundScore: 0, outcome: 'won', gap: 0 });
  });
});

describe('Mabrouk volontaire', () => {
  const spec = (p1: string[], p2: string[], p3: string[]) => ({ hands: { p1, p2, p3 }, discard: '4', deck: ['K', 'K'] });

  it("n'est possible qu'au début de son tour, avant toute action", () => {
    let s = setup(3, spec(['K', 'A', '2', '3'], ['5', '5', '6', '6'], ['7', '7', '8', '8']));
    expect(refused(s, 'p2', { type: 'callMabrouk' })).toMatch(/tour/);
    s = step(s, 'p1', { type: 'draw' });
    expect(refused(s, 'p1', { type: 'callMabrouk' })).toBeTruthy();
    expect(getAvailableActions(s, 'p1').canCallMabrouk).toBe(false);
  });

  it("le déclencheur passe son tour, les autres jouent un dernier tour, la manche s'arrête au retour", () => {
    let s = setup(3, spec(['K', 'A', '2', '3'], ['5', '5', '6', '6'], ['7', '7', '8', '8']));
    const deckBefore = s.deck.length;
    s = step(s, 'p1', { type: 'callMabrouk' });
    expect(s.deck).toHaveLength(deckBefore); // p1 n'a pas joué
    expect(s.currentPlayer).toBe('p2');
    expect(s.finalLap).toEqual({ trigger: 'p1', reason: 'mabrouk' });
    s = passTurn(s);
    expect(s.currentPlayer).toBe('p3');
    s = passTurn(s);
    expect(s.phase).toBe('ROUND_END');
    expect(s.currentPlayer).toBeNull();
    expect(refused(s, 'p1', { type: 'draw' })).toBeTruthy();
  });

  it("la première annonce compte : personne d'autre ne peut re-déclarer", () => {
    let s = setup(3, spec(['K', 'A', '2', '3'], ['5', '5', '6', '6'], ['7', '7', '8', '8']));
    s = step(s, 'p1', { type: 'callMabrouk' });
    expect(refused(s, 'p2', { type: 'callMabrouk' })).toBeTruthy();
    expect(s.finalLap!.trigger).toBe('p1');
  });

  it("avec 2 joueurs : l'autre joue une fois puis la manche se termine", () => {
    let s = setup(2, { hands: { p1: ['K', 'A', '2', '3'], p2: ['5', '5', '6', '6'] }, discard: '4', deck: ['K', 'K'] });
    s = step(s, 'p1', { type: 'callMabrouk' });
    expect(s.currentPlayer).toBe('p2');
    s = passTurn(s);
    expect(s.phase).toBe('ROUND_END');
  });

  it('gagne strictement => 0 pour la manche', () => {
    let s = setup(3, spec(['K', 'A'], ['K', 'A', '2'], ['5', '5', '6', '6']));
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = passTurn(passTurn(s));
    const r = s.history[0];
    expect(r.mabroukOutcome).toBe('won');
    expect(r.roundScores).toEqual({ p1: 0, p2: 6, p3: 26 });
  });

  it('exemple de la règle : il a 3, le meilleur 1 => il marque 3 + 2 = 5', () => {
    let s = setup(3, spec(['K', 'A'], ['K'], ['5', '5', '6', '6']));
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = passTurn(passTurn(s));
    const r = s.history[0];
    expect(r.raw).toMatchObject({ p1: 3, p2: 1 });
    expect(r.mabroukOutcome).toBe('penalty');
    expect(r.penaltyGap).toBe(2);
    expect(r.roundScores.p1).toBe(5);
    expect(r.roundScores.p2).toBe(1);
    expect(s.players[0].score).toBe(5);
  });

  it('à égalité avec le meilleur il ne gagne pas : son score normal (écart 0)', () => {
    let s = setup(3, spec(['K', 'A'], ['A', 'K'], ['5', '5', '6', '6']));
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = passTurn(passTurn(s));
    const r = s.history[0];
    expect(r.mabroukOutcome).toBe('penalty');
    expect(r.roundScores.p1).toBe(3);
  });

  it('le dernier tour peut modifier le résultat (échange de carte)', () => {
    let s = setup(2, { hands: { p1: ['K', 'A'], p2: ['9', 'K'] }, discard: '4', deck: ['K'] });
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = step(s, 'p2', { type: 'draw' });
    s = step(s, 'p2', { type: 'swapHeld', cardId: cardAt(s, 'p2', 0) });
    expect(s.phase).toBe('ROUND_END');
    expect(s.history[0].raw).toMatchObject({ p1: 3, p2: 2 });
    expect(s.history[0].roundScores.p1).toBe(4);
  });

  it('la défausse hors tour reste possible pendant le dernier tour', () => {
    let s = setup(3, { hands: { p1: ['K', 'A'], p2: ['5', '5', '6', '6'], p3: ['7', '7', '8', '8'] }, discard: '4', deck: ['K', 'K'] });
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = step(s, 'p1', { type: 'matchDiscard', cardId: cardAt(s, 'p1', 0) }); // mauvaise carte : pénalité
    expect(s.players[0].hand).toHaveLength(3);
  });

  it('révèle les tapis à la fin de manche', () => {
    let s = setup(2, { hands: { p1: ['K', 'A', '2', '3'], p2: ['5', '5', '6', '6'] }, discard: '4', deck: ['K'] });
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = passTurn(s);
    const v = getPlayerView(s, 'p1', NOW);
    expect(v.players[1].hand.every((c) => c.face !== null)).toBe(true);
    expect(v.lastRound!.hands.p2).toHaveLength(4);
  });
});

describe('fin de manche par tapis vide', () => {
  it('sur son propre tour : il finit son tour, les autres jouent, la manche s\'arrête au retour (score 0)', () => {
    let s = setup(3, { hands: { p1: ['5'], p2: ['6', '6'], p3: ['7', '7'] }, discard: '5', deck: ['K', 'K', 'K'] });
    s = step(s, 'p1', { type: 'matchDiscard', cardId: cardAt(s, 'p1', 0) });
    expect(s.finalLap).toEqual({ trigger: 'p1', reason: 'emptyHand' });
    s = step(s, 'p1', { type: 'draw' });
    expect(getAvailableActions(s, 'p1')).toMatchObject({ canSwapHeld: false, canDiscardHeld: true });
    s = step(s, 'p1', { type: 'discardHeld' });
    expect(s.currentPlayer).toBe('p2');
    s = passTurn(s);
    s = passTurn(s);
    expect(s.phase).toBe('ROUND_END');
    expect(s.history[0].roundScores.p1).toBe(0);
    expect(s.history[0].reason).toBe('emptyHand');
  });

  it('en plein Mabrouk volontaire, un tapis vide ne remplace pas la première annonce', () => {
    let s = setup(3, { hands: { p1: ['K', 'A'], p2: ['5'], p3: ['7', '7', '8', '8'] }, discard: '5', deck: ['K', 'K'] });
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardAt(s, 'p2', 0) });
    expect(s.finalLap).toEqual({ trigger: 'p1', reason: 'mabrouk' });
  });
});

describe('manches et fin de partie', () => {
  function finishRound(s: GameState): GameState {
    s = step(s, s.currentPlayer!, { type: 'callMabrouk' });
    while (s.phase !== 'ROUND_END' && s.phase !== 'GAME_END') s = passTurn(s);
    return s;
  }

  it('cumule les scores, prépare la manche suivante et fait commencer le perdant', () => {
    let s = setup(3, { hands: { p1: ['K', 'K'], p2: ['A', 'A'], p3: ['9', '9'] }, discard: '4', deck: ['K', 'K'] }, { targetScore: 100 });
    s = finishRound(s);
    expect(s.phase).toBe('ROUND_END');
    expect(s.players.map((p) => p.score)).toEqual([0, 4, 20]);
    expect(s.nextStarter).toBe('p3');
    expect(s.history[0].roundRanking.map((r) => r.rank)).toEqual([1, 2, 3]);
    s = step(s, 'p1', { type: 'nextRound' });
    expect(s.phase).toBe('ROUND_END'); // tous doivent être prêts
    expect(refused(s, 'p1', { type: 'nextRound' })).toBeTruthy();
    s = step(s, 'p2', { type: 'nextRound' });
    s = step(s, 'p3', { type: 'nextRound' });
    expect(s.round).toBe(2);
    expect(s.phase).toBe('INITIAL_LOOK');
    expect(s.starter).toBe('p3');
    expect(s.players.map((p) => p.score)).toEqual([0, 4, 20]);
    expect(s.players.every((p) => p.hand.length === 4)).toBe(true);
    expect(Object.keys(s.cards)).toHaveLength(40);
    for (const p of s.players) {
      s = step(s, p.id, { type: 'lookInitial', cardId: p.hand[0] });
      s = step(s, p.id, { type: 'lookInitial', cardId: p.hand[1] });
      s = step(s, p.id, { type: 'ready' });
    }
    expect(s.currentPlayer).toBe('p3');
  });

  it('départage aléatoirement (serveur) les perdants à égalité, jamais un autre joueur', () => {
    const starters = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let s = setup(3, { hands: { p1: ['K', 'K'], p2: ['9', '9'], p3: ['9', '9'] }, discard: '4', deck: ['K', 'K'] }, { targetScore: 100 });
      s.rng = makeRng([i * 2654435761, i * 40503 + 7, i * 97 + 13, i * 1013904223]);
      s = finishRound(s);
      starters.add(s.nextStarter!);
    }
    expect([...starters].sort()).toEqual(['p2', 'p3']);
  });

  it("la partie s'arrête pour tous quand un joueur atteint le seuil ; classement avec égalités", () => {
    let s = setup(3, { hands: { p1: ['K'], p2: ['A'], p3: ['A'] }, discard: '4', deck: ['K', 'K', 'K'] }, { targetScore: 2 });
    s = finishRound(s);
    expect(s.players.map((p) => p.score)).toEqual([0, 2, 2]);
    expect(s.phase).toBe('GAME_END');
    expect(s.winners).toEqual(['p1']);
    const v = getPlayerView(s, 'p2', NOW);
    expect(v.ranking.map((r) => [r.playerId, r.rank])).toEqual([
      ['p1', 1],
      ['p2', 2],
      ['p3', 2],
    ]);
    expect(refused(s, 'p1', { type: 'nextRound' })).toBeTruthy();
    expect(refused(s, 'p1', { type: 'draw' })).toBeTruthy();
    expect(getAvailableActions(s, 'p1').canNextRound).toBe(false);
  });

  it("en cas d'égalité au sommet, les gagnants sont tous classés premiers", () => {
    let s = setup(3, { hands: { p1: ['K'], p2: ['K'], p3: ['9', '9'] }, discard: '4', deck: ['K', 'K'] }, { targetScore: 10 });
    s = finishRound(s);
    expect(s.players.map((p) => p.score)).toEqual([1, 1, 20]);
    expect([...s.winners!].sort()).toEqual(['p1', 'p2']);
  });

  it("ne termine pas la partie tant que personne n'a atteint le seuil", () => {
    let s = setup(2, { hands: { p1: ['K'], p2: ['9', '9'] }, discard: '4', deck: ['K', 'K'] }, { targetScore: 100 });
    s = finishRound(s);
    expect(s.phase).toBe('ROUND_END');
    expect(s.winners).toBeNull();
  });
});

describe('pioche épuisée', () => {
  /** Vide la pioche ; `keepInDiscard` cartes sont ajoutées sous la défausse. */
  function drainDeck(s: GameState, keepInDiscard: number): GameState {
    const move = [...s.deck];
    s.deck = [];
    const pile = [...s.discardPile];
    for (const id of move.slice(0, keepInDiscard)) {
      s.cards[id].location = 'discard';
      s.cards[id].isFaceUp = true;
      pile.unshift(id);
    }
    for (const id of move.slice(keepInDiscard)) s.cards[id].location = 'removed';
    s.discardPile = pile;
    return s;
  }

  it('remélange la défausse, la dernière carte de la défausse reste', () => {
    let s = setup(2, { hands: { p1: ['2', '3', '4', '5'], p2: ['6', '6', '6', 'K'] }, discard: '4' });
    s = drainDeck(s, 5);
    const top = s.discardPile[s.discardPile.length - 1];
    const others = s.discardPile.slice(0, -1);
    const res = step(s, 'p1', { type: 'draw' });
    expect(res.discardPile).toEqual([top]);
    expect(others).toContain(res.held!.cardId);
    expect(res.deck).toHaveLength(others.length - 1);
    expect(res.deck.every((id) => res.cards[id].location === 'deck' && !res.cards[id].isFaceUp)).toBe(true);
    expect(res.phase).toBe('HOLDING');
  });

  it('si rien à remélanger, la manche se termine et on compte les points (sans Mabrouk)', () => {
    let s = setup(3, { hands: { p1: ['K', 'A'], p2: ['K', 'A', '2'], p3: ['5', '5', '6', '6'] }, discard: '4' });
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = drainDeck(s, 0);
    s = step(s, 'p2', { type: 'draw' });
    expect(s.phase).toBe('ROUND_END');
    const r = s.history[0];
    expect(r.reason).toBe('deckExhausted');
    expect(r.mabroukOutcome).toBeNull(); // pas de bonus/malus
    expect(r.roundScores.p1).toBe(3);
    expect(r.roundScores).toEqual(r.raw);
  });

  it('une pénalité impossible à piocher termine aussi la manche', () => {
    let s = setup(2, { hands: { p1: ['2', '3', '4', '5'], p2: ['6', '6', '6', 'K'] }, discard: '4' });
    s = drainDeck(s, 0);
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardAt(s, 'p2', 0) }); // 6 != 4 => pénalité impossible
    expect(s.phase).toBe('ROUND_END');
    expect(s.history[0].reason).toBe('deckExhausted');
  });
});

describe('exclusion (vote unanime)', () => {
  const hands = { p1: ['2', '3', '4', '5'], p2: ['6', '6', '7', '7'], p3: ['8', '8', '9', '9'] };

  it('retire les cartes du jeu et passe la main si le joueur exclu était actif', () => {
    let s = setup(3, { hands, discard: 'A', deck: ['K', 'K', 'K'] });
    const total = Object.values(s.cards).length;
    const res = removePlayer(s, 'p1', { now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    s = res.state;
    expect(s.players[0].status).toBe('removed');
    expect(s.players[0].hand).toHaveLength(0);
    expect(Object.values(s.cards).filter((c) => c.location === 'removed')).toHaveLength(4);
    expect(Object.values(s.cards)).toHaveLength(total);
    expect(s.currentPlayer).toBe('p2');
    expect(refused(s, 'p1', { type: 'draw' })).toBeTruthy();
    s = passTurn(passTurn(s));
    expect(s.currentPlayer).toBe('p2'); // p1 est sauté
  });

  it("termine la partie s'il reste moins de 2 joueurs", () => {
    const s = setup(2);
    const res = removePlayer(s, 'p2', { now: NOW });
    expect(res.ok && res.state.phase).toBe('GAME_END');
    expect(res.ok && res.state.winners).toEqual(['p1']);
  });

  it('si le déclencheur de Mabrouk est exclu, tous les autres jouent quand même leur dernier tour', () => {
    let s = setup(3, { hands: { p1: ['K'], p2: ['5', '5'], p3: ['6', '6'] }, discard: '4', deck: ['K', 'K', 'K'] });
    s = step(s, 'p1', { type: 'callMabrouk' });
    const res = removePlayer(s, 'p1', { now: NOW });
    if (!res.ok) throw new Error(res.error);
    s = res.state;
    expect(s.currentPlayer).toBe('p2');
    s = passTurn(s);
    expect(s.currentPlayer).toBe('p3');
    s = passTurn(s);
    expect(s.phase).toBe('ROUND_END');
    expect(Object.keys(s.history[0].roundScores)).toEqual(['p2', 'p3']);
    expect(s.history[0].mabroukOutcome).toBeNull();
  });

  it('est possible avant le début (les autres prêts => la manche démarre)', () => {
    let s = newGame(3, {}, SEED);
    for (const id of ['p1', 'p2']) {
      const p = s.players.find((x) => x.id === id)!;
      s = step(s, id, { type: 'lookInitial', cardId: p.hand[0] });
      s = step(s, id, { type: 'lookInitial', cardId: p.hand[1] });
      s = step(s, id, { type: 'ready' });
    }
    const res = removePlayer(s, 'p3', { now: NOW });
    expect(res.ok && res.state.phase).toBe('TURN_START');
  });
});

describe('confidentialité', () => {
  it('ne divulgue jamais les cartes cachées, la pioche ni les secrets serveur', () => {
    const s = setup(3, { hands: HANDS3, discard: '4', deck: ['9', 'K'] });
    const view = getPlayerView(s, 'p1', NOW);
    const json = JSON.stringify(view);
    for (const id of s.deck) expect(json.includes(id)).toBe(false);
    for (const c of view.players[1].hand) expect(c.face).toBeNull();
    for (const c of view.players[2].hand) expect(c.face).toBeNull();
    expect(json).not.toMatch(/"rng"|"idRng"|"deck"|"cards"/);
    expect(view.deckCount).toBe(s.deck.length);
  });

  it("aucune info privée n'est envoyée dans un évènement public", () => {
    let s = setup(3, { hands: HANDS3, discard: '4', deck: ['8'] });
    const evs: GameEvent[] = [];
    const target = cardAt(s, 'p1', 0);
    for (const [pid, action] of [
      ['p1', { type: 'draw' }],
      ['p1', { type: 'discardHeld' }],
      ['p1', { type: 'useEffect', params: { cardId: target } }],
    ] as const) {
      const r = act(s, pid, action);
      s = r.state;
      evs.push(...r.events);
    }
    const privateEvents = evs.filter((e) => e.to !== 'all');
    expect(privateEvents.map((e) => e.type).sort()).toEqual(['drawPrivate', 'peek']);
    expect(privateEvents.every((e) => Array.isArray(e.to) && e.to.length === 1 && e.to[0] === 'p1')).toBe(true);
    const pub = evs.filter((e) => e.to === 'all');
    expect(JSON.stringify(pub.find((e) => e.type === 'draw')!.data)).not.toMatch(/rank|value|suit/);
    expect(JSON.stringify(pub.find((e) => e.type === 'peekStart')!.data)).not.toMatch(/rank|value|suit/);
  });

  it('les cartes de la manche précédente ne sont plus celles de la nouvelle manche (nouveaux ids)', () => {
    let s = setup(2, { hands: { p1: ['K'], p2: ['9', '9'] }, discard: '4', deck: ['K', 'K'] }, { targetScore: 100 });
    const oldIds = new Set(Object.keys(s.cards));
    s = step(s, 'p1', { type: 'callMabrouk' });
    s = passTurn(s);
    s = step(s, 'p1', { type: 'nextRound' });
    s = step(s, 'p2', { type: 'nextRound' });
    expect(Object.keys(s.cards).some((id) => oldIds.has(id))).toBe(false);
  });
});
