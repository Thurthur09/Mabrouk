import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, makeConfig } from '../config';
import { createGame, getAvailableActions } from '../engine';
import { getPlayerView } from '../views';
import { NOW, cardAt, ids, newGame, refused, rig, setup, step } from './helpers';

describe('mise en place', () => {
  it('crée 40 cartes (As à 9 + Roi, 4 couleurs) avec les bonnes valeurs', () => {
    const s = newGame(3);
    const cards = Object.values(s.cards);
    expect(cards).toHaveLength(40);
    expect(new Set(cards.map((c) => c.id)).size).toBe(40);
    for (const r of ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'K']) {
      expect(cards.filter((c) => c.rank === r)).toHaveLength(4);
    }
    expect(cards.filter((c) => c.rank === 'K').every((c) => c.value === 0)).toBe(true);
    expect(cards.find((c) => c.rank === 'A')!.value).toBe(1);
    expect(cards.find((c) => c.rank === '9')!.value).toBe(9);
    expect(cards.some((c) => ['10', 'J', 'Q', 'JOKER'].includes(c.rank))).toBe(false);
  });

  it('distribue 4 cartes par joueur, retourne la première défausse et garde le reste en pioche', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = newGame(n);
      expect(s.players.every((p) => p.hand.length === 4)).toBe(true);
      expect(s.discardPile).toHaveLength(1);
      expect(s.cards[s.discardPile[0]].isFaceUp).toBe(true);
      expect(s.deck).toHaveLength(40 - 4 * n - 1);
      expect(s.phase).toBe('INITIAL_LOOK');
      expect(s.round).toBe(1);
      expect(s.players.every((p) => p.score === 0)).toBe(true);
    }
  });

  it('place les cartes en grille 2x2 au départ', () => {
    const s = newGame(2);
    const pos = s.players[0].hand.map((id) => s.cards[id].pos!);
    expect(new Set(pos.map((p) => p.x)).size).toBe(2);
    expect(new Set(pos.map((p) => p.y)).size).toBe(2);
  });

  it('accepte 2 à 6 joueurs et refuse le reste', () => {
    const mk = (n: number) => () => createGame(DEFAULT_CONFIG, ids(n).map((id) => ({ id, name: id })), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(mk(1)).toThrow();
    expect(mk(7)).toThrow();
    expect(mk(2)).not.toThrow();
    expect(mk(6)).not.toThrow();
  });

  it('est déterministe pour une même graine et diffère pour une autre', () => {
    const a = newGame(4, {}, [9, 8, 7, 6, 5, 4, 3, 2]);
    const b = newGame(4, {}, [9, 8, 7, 6, 5, 4, 3, 2]);
    const c = newGame(4, {}, [1, 1, 1, 1, 2, 2, 2, 2]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a.deck)).not.toBe(JSON.stringify(c.deck));
  });

  it("associe les effets par rang selon la config (dynamique)", () => {
    const s = newGame(2);
    const by = (r: string) => Object.values(s.cards).find((c) => c.rank === r)!.effect;
    expect(by('7')).toBe('swapBlind');
    expect(by('8')).toBe('peekOwn');
    expect(by('9')).toBe('peekOther');
    expect(by('K')).toBeNull();
    const t = newGame(2, { effects: { K: 'peekOwn' } });
    expect(Object.values(t.cards).find((c) => c.rank === 'K')!.effect).toBe('peekOwn');
    expect(Object.values(t.cards).find((c) => c.rank === '7')!.effect).toBeNull();
    expect(makeConfig().effects).toEqual(DEFAULT_CONFIG.effects);
  });
});

describe('regard initial', () => {
  it('chaque joueur regarde exactement 2 cartes puis clique Prêt', () => {
    let s = newGame(3);
    const c = s.players[0].hand;
    expect(refused(s, 'p1', { type: 'ready' })).toMatch(/Regardez/);
    s = step(s, 'p1', { type: 'lookInitial', cardId: c[0] });
    expect(refused(s, 'p1', { type: 'lookInitial', cardId: c[0] })).toMatch(/déjà/);
    s = step(s, 'p1', { type: 'lookInitial', cardId: c[3] });
    expect(refused(s, 'p1', { type: 'lookInitial', cardId: c[1] })).toMatch(/déjà regardé/);
    s = step(s, 'p1', { type: 'ready' });
    expect(s.phase).toBe('INITIAL_LOOK');
  });

  it("refuse de regarder la carte d'un autre joueur", () => {
    const s = newGame(2);
    expect(refused(s, 'p1', { type: 'lookInitial', cardId: s.players[1].hand[0] })).toMatch(/tapis/);
  });

  it('démarre quand tous sont prêts, avec le joueur tiré au sort', () => {
    let s = newGame(3);
    const starter = s.starter!;
    for (const p of s.players) {
      s = step(s, p.id, { type: 'lookInitial', cardId: p.hand[0] });
      s = step(s, p.id, { type: 'lookInitial', cardId: p.hand[1] });
      s = step(s, p.id, { type: 'ready' });
    }
    expect(s.phase).toBe('TURN_START');
    expect(s.currentPlayer).toBe(starter);
  });

  it("n'expose les cartes regardées qu'à leur propriétaire, puis les recache", () => {
    let s = newGame(2);
    const [a, b] = s.players[0].hand;
    s = step(s, 'p1', { type: 'lookInitial', cardId: a });
    s = step(s, 'p1', { type: 'lookInitial', cardId: b });
    const mine = getPlayerView(s, 'p1', NOW);
    expect(mine.players[0].hand.filter((c) => c.face).map((c) => c.id).sort()).toEqual([a, b].sort());
    const theirs = getPlayerView(s, 'p2', NOW);
    expect(theirs.players[0].hand.every((c) => c.face === null)).toBe(true);
    s = step(s, 'p1', { type: 'ready' });
    expect(getPlayerView(s, 'p1', NOW).players[0].hand.every((c) => c.face === null)).toBe(true);
  });

  it('refuse toute action de tour avant le début', () => {
    const s = newGame(2);
    expect(refused(s, s.starter!, { type: 'draw' })).toBeTruthy();
    expect(refused(s, 'p1', { type: 'matchDiscard', cardId: s.players[0].hand[0] })).toBeTruthy();
  });
});

describe('déroulement du tour', () => {
  const spec = { hands: { p1: ['2', '3', '4', '5'], p2: ['6', '6', '6', 'K'], p3: ['A', 'A', '2', '9'] }, discard: '4', deck: ['9', '3', 'K'] };

  it("n'autorise que le joueur actif, dans l'ordre horaire p1 -> p2 -> p3 -> p1", () => {
    let s = setup(3, spec);
    expect(s.currentPlayer).toBe('p1');
    expect(refused(s, 'p2', { type: 'draw' })).toMatch(/pas votre tour/);
    s = step(s, 'p1', { type: 'draw' });
    s = step(s, 'p1', { type: 'discardHeld' }); // 9 : effet à résoudre
    s = step(s, 'p1', { type: 'skipEffect' });
    expect(s.currentPlayer).toBe('p2');
    s = step(s, 'p2', { type: 'draw' });
    s = step(s, 'p2', { type: 'swapHeld', cardId: cardAt(s, 'p2', 0) });
    expect(s.currentPlayer).toBe('p3');
    s = step(s, 'p3', { type: 'draw' });
    s = step(s, 'p3', { type: 'discardHeld' });
    expect(s.currentPlayer).toBe('p1');
  });

  it('la pioche est obligatoire : pas de fin de tour sans piocher', () => {
    const s = setup(3, spec);
    const a = getAvailableActions(s, 'p1');
    expect(a).toMatchObject({ canDraw: true, canCallMabrouk: true, canTakeDiscard: true, canSwapHeld: false, canDiscardHeld: false });
    expect(refused(s, 'p1', { type: 'discardHeld' })).toBeTruthy();
    expect(refused(s, 'p1', { type: 'skipEffect' })).toBeTruthy();
    expect(getAvailableActions(s, 'p2').canDraw).toBe(false);
  });

  it("échange avec la défausse (optionnel) PUIS pioche obligatoire dans le même tour", () => {
    let s = setup(3, spec);
    const mine = cardAt(s, 'p1', 1);
    const top = s.discardPile[0];
    s = step(s, 'p1', { type: 'takeDiscard', cardId: mine });
    expect(s.phase).toBe('AWAIT_DRAW');
    expect(s.currentPlayer).toBe('p1');
    expect(s.cards[mine].location).toBe('discard');
    expect(s.cards[mine].isFaceUp).toBe(true);
    expect(s.discardPile[s.discardPile.length - 1]).toBe(mine);
    expect(s.cards[top].owner).toBe('p1');
    expect(s.cards[top].location).toBe('hand');
    expect(s.cards[top].isFaceUp).toBe(false);
    expect(refused(s, 'p1', { type: 'callMabrouk' })).toBeTruthy();
    expect(refused(s, 'p1', { type: 'takeDiscard', cardId: cardAt(s, 'p1', 0) })).toBeTruthy();
    expect(getAvailableActions(s, 'p1')).toMatchObject({ canDraw: true, canTakeDiscard: false, canCallMabrouk: false });
    s = step(s, 'p1', { type: 'draw' });
    expect(s.phase).toBe('HOLDING');
  });

  it("la carte de la défausse prend la place de la carte échangée sur le tapis", () => {
    let s = setup(2, spec);
    const mine = cardAt(s, 'p1', 2);
    const pos = { ...s.cards[mine].pos! };
    const top = s.discardPile[0];
    s = step(s, 'p1', { type: 'takeDiscard', cardId: mine });
    expect(s.cards[top].pos).toEqual(pos);
  });

  it("la carte piochée n'est visible que par le joueur actif", () => {
    let s = setup(3, spec);
    s = step(s, 'p1', { type: 'draw' });
    const held = s.cards[s.held!.cardId];
    const v1 = getPlayerView(s, 'p1', NOW);
    const v2 = getPlayerView(s, 'p2', NOW);
    expect(v1.held!.face).toMatchObject({ rank: held.rank, value: held.value });
    expect(v2.held!.face).toBeNull();
    expect(v2.held!.playerId).toBe('p1');
  });

  it('échanger la carte piochée avec une des siennes : la remplacée part face visible, sans effet', () => {
    let s = setup(3, { ...spec, deck: ['7'] });
    s = step(s, 'p1', { type: 'draw' });
    // le 7 piocher puis posé sur le tapis (pas défaussé directement) : aucun effet
    const handBefore = cardAt(s, 'p1', 0);
    s = step(s, 'p1', { type: 'swapHeld', cardId: handBefore });
    expect(s.discardPile[s.discardPile.length - 1]).toBe(handBefore);
    expect(s.cards[handBefore].isFaceUp).toBe(true);
    expect(s.phase).toBe('TURN_START');
    expect(s.currentPlayer).toBe('p2');
    expect(s.players[0].hand).toHaveLength(4);
  });

  it("refuse d'échanger avec une carte qui n'est pas sur son tapis", () => {
    let s = setup(3, spec);
    s = step(s, 'p1', { type: 'draw' });
    expect(refused(s, 'p1', { type: 'swapHeld', cardId: cardAt(s, 'p2', 0) })).toMatch(/tapis/);
    expect(refused(s, 'p1', { type: 'draw' })).toBeTruthy();
  });

  it('carte du tapis déplaçable librement (cosmétique) sans changer les règles', () => {
    let s = setup(2, spec);
    const id = cardAt(s, 'p1', 0);
    s = step(s, 'p1', { type: 'moveCard', cardId: id, x: 80, y: 15 });
    expect(s.cards[id].pos).toEqual({ x: 80, y: 15 });
    expect(s.currentPlayer).toBe('p1');
    expect(s.phase).toBe('TURN_START');
    s = step(s, 'p1', { type: 'moveCard', cardId: id, x: 999, y: -5 });
    expect(s.cards[id].pos).toEqual({ x: 100, y: 0 });
    expect(refused(s, 'p1', { type: 'moveCard', cardId: cardAt(s, 'p2', 0), x: 1, y: 1 })).toBeTruthy();
    expect(refused(s, 'p1', { type: 'moveCard', cardId: id, x: NaN, y: 1 })).toBeTruthy();
  });

  it('une action illégale ne modifie pas l\'état', () => {
    const s = setup(2, spec);
    const before = JSON.stringify(s);
    refused(s, 'p2', { type: 'draw' });
    refused(s, 'p1', { type: 'swapHeld', cardId: cardAt(s, 'p1', 0) });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('refuse un joueur inconnu ou une action inconnue', () => {
    const s = setup(2, spec);
    refused(s, 'ghost', { type: 'draw' });
    refused(s, 'p1', { type: 'teleport' } as never);
  });
});

describe('plusieurs joueurs', () => {
  it('fonctionne de 2 à 6 joueurs : chacun joue à son tour', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      let s = setup(n);
      const order: string[] = [];
      for (let i = 0; i < n * 2; i++) {
        const cur = s.currentPlayer!;
        order.push(cur);
        s = step(s, cur, { type: 'draw' });
        s = step(s, cur, { type: 'discardHeld' });
        if (s.phase === 'EFFECT') s = step(s, cur, { type: 'skipEffect' });
      }
      expect(order).toEqual(Array.from({ length: n * 2 }, (_, i) => `p${(i % n) + 1}`));
    }
  });

  it('un seul joueur actif à la fois', () => {
    const s = setup(4);
    for (const p of s.players) {
      const av = getAvailableActions(s, p.id);
      expect(av.canDraw).toBe(p.id === s.currentPlayer);
    }
  });

  it('rig() sanity : le tapis construit correspond à la spec', () => {
    const s = rig(newGame(2), { hands: { p1: ['K', 'K', 'K', 'K'], p2: ['9', '9', '9', '9'] }, discard: 'A' });
    expect(s.players[0].hand.every((id) => s.cards[id].rank === 'K')).toBe(true);
    expect(s.cards[s.discardPile[0]].rank).toBe('A');
  });
});
