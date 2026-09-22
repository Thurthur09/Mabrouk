import { describe, expect, it } from 'vitest';
import { applyAction, getAvailableActions, validateAction } from '../engine';
import { next, nextInt, makeRng } from '../rng';
import type { Action, GameState } from '../types';
import { getPlayerView } from '../views';
import { NOW, newGame } from './helpers';

function checkInvariants(s: GameState): void {
  const all = Object.values(s.cards);
  expect(all).toHaveLength(40);
  const inHands = s.players.flatMap((p) => p.hand);
  const counted = s.deck.length + s.discardPile.length + inHands.length + (s.held ? 1 : 0) + all.filter((c) => c.location === 'removed').length;
  expect(counted).toBe(40);
  for (const p of s.players) {
    for (const id of p.hand) {
      expect(s.cards[id].location).toBe('hand');
      expect(s.cards[id].owner).toBe(p.id);
    }
    if (p.status === 'removed') expect(p.hand).toHaveLength(0);
  }
  for (const id of s.deck) expect(s.cards[id].location).toBe('deck');
  for (const id of s.discardPile) expect(s.cards[id].location).toBe('discard');
  const playing = ['TURN_START', 'AWAIT_DRAW', 'HOLDING', 'EFFECT', 'PEEK'].includes(s.phase);
  if (playing) {
    const cur = s.players.find((p) => p.id === s.currentPlayer);
    expect(cur?.status).toBe('active');
  } else {
    expect(s.currentPlayer).toBeNull();
  }
  // un seul joueur peut jouer son tour à la fois
  const turnTakers = s.players.filter((p) => {
    const a = getAvailableActions(s, p.id);
    return a.canDraw || a.canCallMabrouk || a.canTakeDiscard || a.canSwapHeld || a.canDiscardHeld || !!a.canUseEffect || a.canSkipEffect;
  });
  expect(turnTakers.length).toBeLessThanOrEqual(1);
}

/** Toutes les actions candidates d'un joueur (avec paramètres) : on ne garde que les légales. */
function legalActions(s: GameState, pid: string): Action[] {
  const p = s.players.find((x) => x.id === pid)!;
  const out: Action[] = [];
  const push = (a: Action) => {
    if (validateAction(s, pid, a) === null) out.push(a);
  };
  push({ type: 'ready' });
  push({ type: 'callMabrouk' });
  push({ type: 'draw' });
  push({ type: 'discardHeld' });
  push({ type: 'skipEffect' });
  push({ type: 'confirmPeek' });
  push({ type: 'nextRound' });
  for (const id of p.hand) {
    push({ type: 'lookInitial', cardId: id });
    push({ type: 'takeDiscard', cardId: id });
    push({ type: 'swapHeld', cardId: id });
    push({ type: 'matchDiscard', cardId: id });
    push({ type: 'useEffect', params: { cardId: id } });
    for (const o of s.players) {
      if (o.id === pid) continue;
      for (const oid of o.hand) push({ type: 'useEffect', params: { ownCardId: id, targetPlayerId: o.id, targetCardId: oid } });
    }
  }
  for (const o of s.players) for (const oid of o.hand) if (o.id !== pid) push({ type: 'useEffect', params: { targetPlayerId: o.id, targetCardId: oid } });
  return out;
}

describe('parties aléatoires (fuzz) : invariants du moteur', () => {
  it('joue des actions légales au hasard sans jamais casser l\'état ni créer deux joueurs actifs', () => {
    for (let game = 0; game < 40; game++) {
      const rng = makeRng([game * 7919 + 1, game * 104729 + 3, game * 13 + 5, game * 977 + 11]);
      const n = 2 + (game % 5);
      let s = newGame(n, { targetScore: 25 }, [game + 1, 2 * game + 3, 3 * game + 5, 5 * game + 7, 11 * game + 13, 17 * game + 19, 23 * game + 29, 31 * game + 37]);
      let steps = 0;
      while (s.phase !== 'GAME_END' && steps < 6000) {
        steps++;
        // On choisit un joueur au hasard parmi ceux qui ont au moins une action légale (hors rare match).
        const candidates = s.players.filter((p) => p.status === 'active').flatMap((p) => legalActions(s, p.id).map((a) => ({ pid: p.id, a })));
        const structural = candidates.filter((c) => c.a.type !== 'matchDiscard');
        const pool = structural.length && next(rng) > 0.04 ? structural : candidates;
        expect(pool.length).toBeGreaterThan(0); // jamais d'impasse
        const pick = pool[nextInt(rng, pool.length)];
        const res = applyAction(s, pick.pid, pick.a, { now: NOW + steps });
        expect(res.ok).toBe(true);
        if (!res.ok) break;
        s = res.state;
        if (steps % 5 === 0) checkInvariants(s);
        // Les vues ne contiennent jamais la pioche
        if (steps % 50 === 0) {
          const json = JSON.stringify(getPlayerView(s, s.players[0].id, NOW));
          for (const id of s.deck.slice(0, 5)) expect(json.includes(id)).toBe(false);
        }
      }
      checkInvariants(s);
      expect(steps).toBeLessThan(6000);
      expect(s.phase).toBe('GAME_END');
      expect(s.winners!.length).toBeGreaterThan(0);
    }
  });

  it("getAvailableActions est cohérent avec la validation du moteur", () => {
    const rng = makeRng([5, 6, 7, 8]);
    let s = newGame(3, { targetScore: 30 });
    for (let i = 0; i < 400 && s.phase !== 'GAME_END'; i++) {
      for (const p of s.players) {
        const a = getAvailableActions(s, p.id);
        const legal = legalActions(s, p.id);
        const has = (t: string) => legal.some((x) => x.type === t);
        expect(a.canDraw).toBe(has('draw'));
        expect(a.canCallMabrouk).toBe(has('callMabrouk'));
        expect(a.canTakeDiscard).toBe(has('takeDiscard'));
        expect(a.canSwapHeld).toBe(has('swapHeld'));
        expect(a.canDiscardHeld).toBe(has('discardHeld'));
        expect(a.canSkipEffect).toBe(has('skipEffect'));
        expect(a.canConfirmPeek).toBe(has('confirmPeek'));
        expect(a.canMatchDiscard).toBe(has('matchDiscard'));
        expect(a.canReady).toBe(has('ready'));
        expect(a.canNextRound).toBe(has('nextRound'));
        expect(a.canLookInitial).toBe(has('lookInitial'));
      }
      const cands = s.players.flatMap((p) => legalActions(s, p.id).map((a) => ({ pid: p.id, a }))).filter((c) => c.a.type !== 'matchDiscard');
      const pick = cands[nextInt(rng, cands.length)];
      const res = applyAction(s, pick.pid, pick.a, { now: NOW + i });
      if (!res.ok) throw new Error(res.error);
      s = res.state;
    }
  });
});
