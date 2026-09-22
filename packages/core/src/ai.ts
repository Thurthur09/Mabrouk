// AI : bot « Facile ». N'utilise QUE la GameView (ce qu'un humain à cette place pourrait savoir)
// et joue via les mêmes actions que les humains, validées par le moteur.
import type { GameView } from './views';
import type { Action, CardId, PlayerId } from './types';

export interface BotDecision {
  action: Action;
  delayMs: number;
}

export class EasyBot {
  /** Ce que le bot a vu de ses propres cartes : id de carte -> valeur. */
  private memory = new Map<CardId, number>();
  private matchChoice = new Map<CardId, boolean>();

  constructor(
    public readonly id: PlayerId,
    private rnd: () => number = Math.random,
  ) {}

  reset(): void {
    this.memory.clear();
    this.matchChoice.clear();
  }

  private learn(view: GameView): void {
    const me = view.players.find((p) => p.id === this.id);
    if (!me) return;
    for (const c of me.hand) if (c.face && view.phase !== 'ROUND_END' && view.phase !== 'GAME_END') this.memory.set(c.id, c.face.value);
    if (view.held?.playerId === this.id && view.held.face) this.memory.set(view.held.cardId, view.held.face.value);
    if (view.peek?.playerId === this.id && view.peek.face) this.memory.set(view.peek.cardId, view.peek.face.value);
  }

  private delay(min: number, span: number): number {
    return Math.round(min + this.rnd() * span);
  }

  private randomOf<T>(arr: T[]): T {
    return arr[Math.floor(this.rnd() * arr.length)];
  }

  decide(view: GameView): BotDecision | null {
    this.learn(view);
    const me = view.players.find((p) => p.id === this.id);
    if (!me || me.status !== 'active') return null;
    const a = view.available;

    // Réaction à la défausse : uniquement avec une carte dont il se souvient (jamais de triche).
    if (a.canMatchDiscard && view.discardTop) {
      const top = view.discardTop;
      if (!this.matchChoice.has(top.id)) this.matchChoice.set(top.id, this.rnd() < 0.7);
      if (this.matchChoice.get(top.id)) {
        const c = me.hand.find((h) => this.memory.get(h.id) === top.value);
        if (c) return { action: { type: 'matchDiscard', cardId: c.id }, delayMs: this.delay(1500, 2000) };
      }
    }

    if (a.canLookInitial) {
      const unseen = me.hand.filter((c) => c.face === null);
      if (unseen.length) return { action: { type: 'lookInitial', cardId: this.randomOf(unseen).id }, delayMs: this.delay(600, 600) };
    }
    if (a.canReady) return { action: { type: 'ready' }, delayMs: this.delay(800, 800) };
    if (a.canNextRound) return { action: { type: 'nextRound' }, delayMs: this.delay(1500, 1000) };
    if (a.canConfirmPeek) return { action: { type: 'confirmPeek' }, delayMs: this.delay(1000, 800) };

    if (a.canUseEffect || a.canSkipEffect) return this.decideEffect(view, a.canUseEffect);

    if (a.canCallMabrouk || a.canTakeDiscard || a.canDraw) return this.decideTurnStart(view);
    if (a.canSwapHeld || a.canDiscardHeld) return this.decideHolding(view);
    return null;
  }

  private known(view: GameView): { id: CardId; value: number }[] {
    const me = view.players.find((p) => p.id === this.id)!;
    return me.hand.filter((c) => this.memory.has(c.id)).map((c) => ({ id: c.id, value: this.memory.get(c.id)! }));
  }

  private unknownIds(view: GameView): CardId[] {
    const me = view.players.find((p) => p.id === this.id)!;
    return me.hand.filter((c) => !this.memory.has(c.id)).map((c) => c.id);
  }

  private decideTurnStart(view: GameView): BotDecision | null {
    const a = view.available;
    const me = view.players.find((p) => p.id === this.id)!;
    const known = this.known(view);
    if (a.canCallMabrouk && me.hand.length > 0) {
      const estimate = known.reduce((s, k) => s + k.value + 1, 0) + this.unknownIds(view).length * 5.5;
      if (estimate <= 8) return { action: { type: 'callMabrouk' }, delayMs: this.delay(900, 600) };
    }
    if (a.canTakeDiscard && view.discardTop && view.discardTop.value <= 2 && known.length) {
      const worst = known.reduce((m, k) => (k.value > m.value ? k : m));
      if (worst.value >= view.discardTop.value + 3) {
        // la carte de la défausse est publique : le bot connaît sa valeur une fois posée sur son tapis
        this.memory.set(view.discardTop.id, view.discardTop.value);
        return { action: { type: 'takeDiscard', cardId: worst.id }, delayMs: this.delay(900, 700) };
      }
    }
    if (a.canDraw) return { action: { type: 'draw' }, delayMs: this.delay(800, 700) };
    return null;
  }

  private decideHolding(view: GameView): BotDecision | null {
    const a = view.available;
    const held = view.held?.face;
    if (!held) return null;
    const known = this.known(view);
    if (a.canSwapHeld) {
      if (known.length) {
        const worst = known.reduce((m, k) => (k.value > m.value ? k : m));
        if (worst.value - held.value >= 2) {
          return { action: { type: 'swapHeld', cardId: worst.id }, delayMs: this.delay(900, 700) };
        }
      }
      const unknown = this.unknownIds(view);
      if (held.value <= 3 && unknown.length) {
        return { action: { type: 'swapHeld', cardId: this.randomOf(unknown) }, delayMs: this.delay(900, 700) };
      }
    }
    if (a.canDiscardHeld) return { action: { type: 'discardHeld' }, delayMs: this.delay(800, 600) };
    return null;
  }

  private decideEffect(view: GameView, effect: string | null): BotDecision | null {
    const skip: BotDecision = { action: { type: 'skipEffect' }, delayMs: this.delay(700, 500) };
    if (!effect) return skip;
    const me = view.players.find((p) => p.id === this.id)!;
    const opponents = view.players.filter((p) => p.id !== this.id && p.status === 'active' && p.hand.length > 0);
    if (effect === 'peekOwn') {
      const unknown = this.unknownIds(view);
      if (!unknown.length) return skip;
      return { action: { type: 'useEffect', params: { cardId: this.randomOf(unknown) } }, delayMs: this.delay(800, 600) };
    }
    if (effect === 'peekOther') {
      if (!opponents.length) return skip;
      const o = this.randomOf(opponents);
      return {
        action: { type: 'useEffect', params: { targetPlayerId: o.id, targetCardId: this.randomOf(o.hand).id } },
        delayMs: this.delay(800, 600),
      };
    }
    if (effect === 'swapBlind') {
      if (!opponents.length || !me.hand.length) return skip;
      const known = this.known(view);
      const worst = known.length ? known.reduce((m, k) => (k.value > m.value ? k : m)) : null;
      const own = worst && worst.value >= 6 ? worst.id : this.unknownIds(view).length && this.rnd() < 0.5 ? this.randomOf(this.unknownIds(view)) : null;
      if (!own) return skip;
      const o = this.randomOf(opponents);
      return {
        action: { type: 'useEffect', params: { ownCardId: own, targetPlayerId: o.id, targetCardId: this.randomOf(o.hand).id } },
        delayMs: this.delay(900, 700),
      };
    }
    return skip;
  }
}
