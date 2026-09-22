import { describe, expect, it } from 'vitest';
import { getAvailableActions } from '../engine';
import { getPlayerView } from '../views';
import { NOW, act, cardAt, cardOfRank, refused, setup, step } from './helpers';

const base = { hands: { p1: ['2', '3', '4', '5'], p2: ['6', 'A', 'K', '9'], p3: ['2', '3', 'A', '5'] }, discard: '4' };

function drawAndDiscard(rank: string, config = {}) {
  let s = setup(3, { ...base, deck: [rank, 'K', 'K'] }, config);
  s = step(s, 'p1', { type: 'draw' });
  s = step(s, 'p1', { type: 'discardHeld' });
  return s;
}

describe('effet du 7 : échange à l\'aveugle avec un autre joueur', () => {
  it('se déclenche quand le 7 est piochée puis défaussée directement', () => {
    const s = drawAndDiscard('7');
    expect(s.phase).toBe('EFFECT');
    expect(s.pendingEffect).toMatchObject({ playerId: 'p1', effect: 'swapBlind' });
    expect(getAvailableActions(s, 'p1')).toMatchObject({ canUseEffect: 'swapBlind', canSkipEffect: true });
    expect(s.currentPlayer).toBe('p1');
  });

  it('échange une de mes cartes avec une carte adverse, positions comprises, sans rien révéler', () => {
    let s = drawAndDiscard('7');
    const mine = cardAt(s, 'p1', 1);
    const theirs = cardAt(s, 'p2', 2);
    const myPos = { ...s.cards[mine].pos! };
    const theirPos = { ...s.cards[theirs].pos! };
    const res = act(s, 'p1', { type: 'useEffect', params: { ownCardId: mine, targetPlayerId: 'p2', targetCardId: theirs } });
    s = res.state;
    expect(s.cards[mine].owner).toBe('p2');
    expect(s.cards[theirs].owner).toBe('p1');
    expect(s.cards[mine].pos).toEqual(theirPos);
    expect(s.cards[theirs].pos).toEqual(myPos);
    expect(s.players[0].hand).toHaveLength(4);
    expect(s.players[1].hand).toHaveLength(4);
    expect(s.currentPlayer).toBe('p2'); // l'effet termine le tour
    // les cartes échangées ne sont pas visibles
    const swapEvent = res.events.find((e) => e.type === 'swap')!;
    expect(swapEvent.to).toBe('all');
    expect(JSON.stringify(swapEvent.data)).not.toMatch(/rank|value|suit/);
    expect(getPlayerView(s, 'p1', NOW).players[0].hand.every((c) => c.face === null)).toBe(true);
  });

  it('refuse un échange avec soi-même, avec un joueur exclu ou avec une carte qui n\'existe pas chez la cible', () => {
    const s = drawAndDiscard('7');
    const mine = cardAt(s, 'p1', 0);
    expect(refused(s, 'p1', { type: 'useEffect', params: { ownCardId: mine, targetPlayerId: 'p1', targetCardId: cardAt(s, 'p1', 1) } })).toMatch(/autre joueur/);
    expect(refused(s, 'p1', { type: 'useEffect', params: { ownCardId: mine, targetPlayerId: 'p2', targetCardId: cardAt(s, 'p3', 0) } })).toMatch(/cible/);
    expect(refused(s, 'p1', { type: 'useEffect', params: { ownCardId: cardAt(s, 'p2', 0), targetPlayerId: 'p2', targetCardId: cardAt(s, 'p2', 1) } })).toMatch(/tapis/);
    expect(refused(s, 'p1', { type: 'useEffect', params: {} })).toBeTruthy();
  });

  it("est optionnel : on peut passer et le tour se termine", () => {
    let s = drawAndDiscard('7');
    s = step(s, 'p1', { type: 'skipEffect' });
    expect(s.currentPlayer).toBe('p2');
    expect(s.phase).toBe('TURN_START');
    expect(s.pendingEffect).toBeNull();
  });
});

describe('effet du 8 : regarder une de ses cartes', () => {
  it('révèle la carte choisie à moi seul jusqu\'à confirmation', () => {
    let s = drawAndDiscard('8');
    expect(s.pendingEffect!.effect).toBe('peekOwn');
    const target = cardAt(s, 'p1', 2);
    const res = act(s, 'p1', { type: 'useEffect', params: { cardId: target } });
    s = res.state;
    expect(s.phase).toBe('PEEK');
    expect(s.currentPlayer).toBe('p1');
    const v1 = getPlayerView(s, 'p1', NOW);
    const v2 = getPlayerView(s, 'p2', NOW);
    expect(v1.players[0].hand.find((c) => c.id === target)!.face).toMatchObject({ rank: '4' });
    expect(v2.players[0].hand.find((c) => c.id === target)!.face).toBeNull();
    expect(v1.players[0].hand.filter((c) => c.face)).toHaveLength(1);
    // l'évènement contenant la valeur est privé
    const priv = res.events.find((e) => e.type === 'peek')!;
    expect(priv.to).toEqual(['p1']);
    expect(res.events.filter((e) => e.to === 'all').some((e) => JSON.stringify(e.data).includes('"rank"'))).toBe(false);
    s = step(s, 'p1', { type: 'confirmPeek' });
    expect(s.currentPlayer).toBe('p2');
    expect(getPlayerView(s, 'p1', NOW).players[0].hand.every((c) => c.face === null)).toBe(true);
  });

  it('ne permet pas de regarder la carte d\'un adversaire', () => {
    const s = drawAndDiscard('8');
    expect(refused(s, 'p1', { type: 'useEffect', params: { cardId: cardAt(s, 'p2', 0) } })).toMatch(/tapis/);
  });

  it('seul le joueur concerné peut confirmer', () => {
    let s = drawAndDiscard('8');
    s = step(s, 'p1', { type: 'useEffect', params: { cardId: cardAt(s, 'p1', 0) } });
    expect(refused(s, 'p2', { type: 'confirmPeek' })).toBeTruthy();
  });
});

describe('effet du 9 : regarder une carte adverse', () => {
  it('révèle une carte adverse à moi seul', () => {
    let s = drawAndDiscard('9');
    expect(s.pendingEffect!.effect).toBe('peekOther');
    const target = cardAt(s, 'p3', 3);
    s = step(s, 'p1', { type: 'useEffect', params: { targetPlayerId: 'p3', targetCardId: target } });
    expect(s.phase).toBe('PEEK');
    const seen = getPlayerView(s, 'p1', NOW).players[2].hand.find((c) => c.id === target)!;
    expect(seen.face).toMatchObject({ rank: '5', value: 5 });
    expect(getPlayerView(s, 'p3', NOW).players[2].hand.find((c) => c.id === target)!.face).toBeNull();
    expect(getPlayerView(s, 'p2', NOW).players[2].hand.find((c) => c.id === target)!.face).toBeNull();
  });

  it('refuse de cibler soi-même', () => {
    const s = drawAndDiscard('9');
    expect(refused(s, 'p1', { type: 'useEffect', params: { targetPlayerId: 'p1', targetCardId: cardAt(s, 'p1', 0) } })).toMatch(/autre joueur/);
  });
});

describe("l'effet ne se déclenche que pour une carte piochée puis défaussée directement", () => {
  it('pas d\'effet pour une carte piochée puis posée sur le tapis', () => {
    let s = setup(3, { ...base, deck: ['8'] });
    s = step(s, 'p1', { type: 'draw' });
    s = step(s, 'p1', { type: 'swapHeld', cardId: cardAt(s, 'p1', 0) });
    expect(s.phase).toBe('TURN_START');
    expect(s.pendingEffect).toBeNull();
  });

  it('pas d\'effet pour une carte du tapis échangée vers la défausse (même un 7/8/9)', () => {
    const hands = { p1: ['7', '8', '9', '5'], p2: ['6', 'A', 'K', '9'], p3: ['2', '3', 'A', '5'] };
    let s = setup(3, { hands, discard: '4', deck: ['K'] });
    s = step(s, 'p1', { type: 'draw' });
    s = step(s, 'p1', { type: 'swapHeld', cardId: cardOfRank(s, 'p1', '9') });
    expect(s.pendingEffect).toBeNull();
    expect(s.currentPlayer).toBe('p2');
    let t = setup(3, { hands, discard: '4', deck: ['K'] });
    t = step(t, 'p1', { type: 'takeDiscard', cardId: cardOfRank(t, 'p1', '7') });
    expect(t.pendingEffect).toBeNull();
    expect(t.phase).toBe('AWAIT_DRAW');
  });

  it('pas d\'effet pour une carte défaussée hors tour (même valeur)', () => {
    const hands = { p1: ['2', '3', '4', '5'], p2: ['7', '8', 'K', '9'], p3: ['2', '3', 'A', '5'] };
    let s = setup(3, { hands, discard: '7', deck: ['K'] });
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardOfRank(s, 'p2', '7') });
    expect(s.pendingEffect).toBeNull();
    expect(s.phase).toBe('TURN_START');
    expect(s.currentPlayer).toBe('p1');
  });

  it("une carte sans effet (2..6, As, Roi) se défausse simplement", () => {
    for (const r of ['A', '2', '3', '4', '5', '6', 'K']) {
      const s = drawAndDiscard(r);
      expect(s.phase, r).toBe('TURN_START');
      expect(s.currentPlayer, r).toBe('p2');
    }
  });

  it('effets dynamiques : la config décide (Roi = regarder ; 7 sans effet)', () => {
    let s = drawAndDiscard('K', { effects: { K: 'peekOwn' } });
    expect(s.phase).toBe('EFFECT');
    expect(s.pendingEffect!.effect).toBe('peekOwn');
    s = drawAndDiscard('7', { effects: { K: 'peekOwn' } });
    expect(s.phase).toBe('TURN_START');
    s = drawAndDiscard('9', { effects: {} });
    expect(s.phase).toBe('TURN_START');
  });

  it("un effet sans cible possible est ignoré (aucune carte adverse à échanger)", () => {
    // p2 n'a plus de carte : il a déclenché Mabrouk automatique ; l'effet 7 de p1 est sans cible
    const hands = { p1: ['2', '3', '4', '5'], p2: ['5'], p3: [] as string[] };
    let s = setup(3, { hands, discard: '5', deck: ['7'] });
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardAt(s, 'p2', 0) });
    expect(s.finalLap).toMatchObject({ trigger: 'p2', reason: 'emptyHand' });
    s = step(s, 'p1', { type: 'draw' });
    s = step(s, 'p1', { type: 'discardHeld' });
    // aucun adversaire n'a de carte : l'effet est ignoré, on arrive sur p2 (déclencheur) => fin de manche
    expect(s.pendingEffect).toBeNull();
    expect(s.phase).toBe('ROUND_END');
  });
});

describe('défausse hors tour', () => {
  it('accepte une carte de même valeur, à tout moment, par n\'importe quel joueur', () => {
    let s = setup(3, { ...base, discard: '5' });
    const c = cardOfRank(s, 'p3', '5');
    s = step(s, 'p3', { type: 'matchDiscard', cardId: c });
    expect(s.discardPile[s.discardPile.length - 1]).toBe(c);
    expect(s.cards[c].isFaceUp).toBe(true);
    expect(s.players[2].hand).toHaveLength(3);
    expect(s.currentPlayer).toBe('p1'); // le tour n'est pas modifié
    expect(s.phase).toBe('TURN_START');
  });

  it('se répète carte par carte, autant que voulu', () => {
    let s = setup(3, { hands: { p1: ['2', '3', '4', '5'], p2: ['6', '6', '6', 'K'], p3: ['2', '3', 'A', '5'] }, discard: '6' });
    for (let i = 0; i < 3; i++) s = step(s, 'p2', { type: 'matchDiscard', cardId: cardOfRank(s, 'p2', '6') });
    expect(s.players[1].hand).toHaveLength(1);
    expect(s.discardPile).toHaveLength(4);
  });

  it('le Roi (0) ne correspond qu\'au Roi ; comparaison par valeur, pas par couleur', () => {
    const hands = { p1: ['K', '3', '4', '5'], p2: ['K', 'A', '2', '9'], p3: ['2', '3', 'A', '5'] };
    let s = setup(3, { hands, discard: 'K' });
    s = step(s, 'p1', { type: 'matchDiscard', cardId: cardOfRank(s, 'p1', 'K') });
    expect(s.players[0].hand).toHaveLength(3);
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardOfRank(s, 'p2', 'K') });
    expect(s.players[1].hand).toHaveLength(3);
    // un As n'est pas un Roi
    const before = s.players[1].hand.length;
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardOfRank(s, 'p2', 'A') });
    expect(s.players[1].hand).toHaveLength(before + 1);
  });

  it("mauvaise carte : elle reste, est révélée en rouge 5 s, et le joueur pioche une carte face cachée", () => {
    let s = setup(3, { ...base, discard: '5' });
    const wrong = cardOfRank(s, 'p2', '9');
    const deckBefore = s.deck.length;
    const res = act(s, 'p2', { type: 'matchDiscard', cardId: wrong }, NOW);
    s = res.state;
    expect(s.players[1].hand).toHaveLength(5);
    expect(s.players[1].hand).toContain(wrong);
    expect(s.deck).toHaveLength(deckBefore - 1);
    expect(s.discardPile).toHaveLength(1);
    const penaltyId = s.players[1].hand[4];
    expect(s.cards[penaltyId].location).toBe('hand');
    expect(s.cards[penaltyId].isFaceUp).toBe(false);
    // pénalité posée à un emplacement libre
    const p = s.cards[penaltyId].pos!;
    for (const id of s.players[1].hand.slice(0, 4)) {
      const q = s.cards[id].pos!;
      expect(Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y))).toBeGreaterThanOrEqual(15);
    }
    // les autres voient la carte pendant 5 secondes
    const seen = getPlayerView(s, 'p3', NOW + 1000).players[1].hand.find((c) => c.id === wrong)!;
    expect(seen.face).toMatchObject({ rank: '9' });
    expect(seen.redUntil).toBe(NOW + 5000);
    const later = getPlayerView(s, 'p3', NOW + 5001).players[1].hand.find((c) => c.id === wrong)!;
    expect(later.face).toBeNull();
    expect(later.redUntil).toBeNull();
    // la carte de pénalité, elle, reste cachée pour tout le monde
    expect(getPlayerView(s, 'p3', NOW + 1000).players[1].hand.find((c) => c.id === penaltyId)!.face).toBeNull();
    expect(res.events.find((e) => e.type === 'matchFail')!.to).toBe('all');
  });

  it("chaque mauvaise carte coûte une carte de pénalité", () => {
    let s = setup(3, { ...base, discard: '5' });
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardOfRank(s, 'p2', '9') });
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardOfRank(s, 'p2', 'K') });
    expect(s.players[1].hand).toHaveLength(6);
  });

  it('est possible pendant la pioche, un effet ou un regard, mais pas avant le début ni après la manche', () => {
    let s = setup(3, { ...base, deck: ['8'], discard: '3' });
    s = step(s, 'p1', { type: 'draw' });
    expect(getAvailableActions(s, 'p3').canMatchDiscard).toBe(true);
    s = step(s, 'p3', { type: 'matchDiscard', cardId: cardOfRank(s, 'p3', '3') }); // pendant HOLDING
    s = step(s, 'p1', { type: 'discardHeld' });
    expect(s.phase).toBe('EFFECT');
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardOfRank(s, 'p2', 'K') }); // pendant EFFECT (mauvaise carte)
    expect(s.phase).toBe('EFFECT');
    s = step(s, 'p1', { type: 'useEffect', params: { cardId: cardAt(s, 'p1', 0) } });
    expect(s.phase).toBe('PEEK');
    expect(getAvailableActions(s, 'p3').canMatchDiscard).toBe(true);
  });

  it("refuse la carte d'un autre joueur et la défausse vide impossible", () => {
    const s = setup(3, { ...base, discard: '5' });
    expect(refused(s, 'p1', { type: 'matchDiscard', cardId: cardAt(s, 'p2', 0) })).toMatch(/tapis/);
  });

  it('vider son tapis déclenche Mabrouk automatiquement (score 0, aucun bonus/malus)', () => {
    const hands = { p1: ['2', '3', '4', '5'], p2: ['5'], p3: ['2', '3', 'A', '5'] };
    let s = setup(3, { hands, discard: '5', deck: ['K', 'K'] });
    s = step(s, 'p2', { type: 'matchDiscard', cardId: cardAt(s, 'p2', 0) });
    expect(s.finalLap).toEqual({ trigger: 'p2', reason: 'emptyHand' });
    expect(s.currentPlayer).toBe('p1'); // le tour en cours n'est pas interrompu
    s = step(s, 'p1', { type: 'draw' });
    s = step(s, 'p1', { type: 'discardHeld' });
    // p1 termine son tour, puis on arrive sur p2 : la manche s'arrête (p3 ne rejoue pas)
    expect(s.phase).toBe('ROUND_END');
    const r = s.history[0];
    expect(r.reason).toBe('emptyHand');
    expect(r.mabroukOutcome).toBeNull();
    expect(r.roundScores.p2).toBe(0);
    expect(r.roundScores.p1).toBe(r.raw.p1);
    expect(r.roundScores.p3).toBe(r.raw.p3);
  });
});
