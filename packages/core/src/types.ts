// ============================================================================
// Types du moteur Mabrouk (Dutch / Tamoul). Aucune dépendance à l'UI.
// ============================================================================

export type PlayerId = string;
export type CardId = string;
export type Suit = 'S' | 'H' | 'D' | 'C';
export type EffectId = string;
export type RngState = [number, number, number, number];

export interface RankDef {
  rank: string;
  value: number;
}

/** Paramétrage des règles. Les valeurs par défaut sont celles de la spécification. */
export interface GameConfig {
  minPlayers: number;
  maxPlayers: number;
  /** Seuil X : la partie s'arrête pour tous quand un joueur atteint ce total. */
  targetScore: number;
  handSize: number;
  initialLookCount: number;
  gridColumns: number;
  /** Durée pendant laquelle une mauvaise défausse est signalée en rouge. */
  penaltyRevealMs: number;
  suits: Suit[];
  ranks: RankDef[];
  /** Effets dynamiques : rang -> identifiant d'effet. Ajouter/retirer une entrée suffit. */
  effects: Record<string, EffectId>;
}

export type CardLocation = 'deck' | 'hand' | 'discard' | 'held' | 'removed';

export interface Pos {
  x: number;
  y: number;
}

export interface Card {
  id: CardId;
  rank: string;
  suit: Suit;
  value: number;
  effect: EffectId | null;
  location: CardLocation;
  owner: PlayerId | null;
  isFaceUp: boolean;
  /** Position sur le tapis du propriétaire (pourcentages 0..100, purement cosmétique). */
  pos: Pos | null;
}

export type PlayerStatus = 'active' | 'removed';

export interface Player {
  id: PlayerId;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  /** Cartes du tapis (ids). */
  hand: CardId[];
  /** Score cumulé de la partie. */
  score: number;
  /** Score de la dernière manche terminée. */
  roundScore: number | null;
  status: PlayerStatus;
}

export type Phase =
  | 'INITIAL_LOOK' // chacun regarde 2 de ses cartes puis clique « Prêt »
  | 'TURN_START' // joueur actif : Mabrouk / échange défausse / pioche
  | 'AWAIT_DRAW' // échange avec la défausse fait : pioche obligatoire
  | 'HOLDING' // carte piochée en main : échanger ou défausser
  | 'EFFECT' // carte à effet défaussée : utiliser (optionnel) ou passer
  | 'PEEK' // le joueur regarde une carte (8/9) jusqu'à confirmation
  | 'ROUND_END' // manche terminée, scores affichés
  | 'GAME_END';

export type RoundEndReason = 'mabrouk' | 'emptyHand' | 'deckExhausted';

export interface FinalLap {
  trigger: PlayerId;
  reason: 'mabrouk' | 'emptyHand';
}

export interface RoundResult {
  round: number;
  reason: RoundEndReason;
  /** Joueur ayant déclenché Mabrouk (annonce ou main vide), s'il y en a un. */
  trigger: PlayerId | null;
  /** Issue du Mabrouk volontaire : gagné (0), pénalité (écart), ou null. */
  mabroukOutcome: 'won' | 'penalty' | null;
  penaltyGap: number;
  raw: Record<PlayerId, number>;
  roundScores: Record<PlayerId, number>;
  totals: Record<PlayerId, number>;
  roundRanking: RankEntry[];
  globalRanking: RankEntry[];
  hands: Record<PlayerId, { id: CardId; rank: string; suit: Suit; value: number }[]>;
  nextStarter: PlayerId | null;
}

export interface RankEntry {
  playerId: PlayerId;
  score: number;
  rank: number;
}

export interface Reveal {
  cardId: CardId;
  until: number;
}

export interface GameState {
  config: GameConfig;
  /** Ordre de table = sens horaire. Les joueurs exclus restent listés (status 'removed'). */
  players: Player[];
  cards: Record<CardId, Card>;
  /** Le dessus de la pioche est le dernier élément. */
  deck: CardId[];
  /** Le dessus de la défausse est le dernier élément. */
  discardPile: CardId[];
  currentPlayer: PlayerId | null;
  round: number;
  phase: Phase;
  held: { playerId: PlayerId; cardId: CardId } | null;
  pendingEffect: { playerId: PlayerId; effect: EffectId; cardId: CardId } | null;
  peek: { playerId: PlayerId; cardId: CardId } | null;
  initialLook: Record<PlayerId, CardId[]>;
  /** Joueurs prêts (regard initial, ou passage à la manche suivante). */
  ready: PlayerId[];
  finalLap: FinalLap | null;
  reveals: Reveal[];
  starter: PlayerId | null;
  nextStarter: PlayerId | null;
  history: RoundResult[];
  winners: PlayerId[] | null;
  /** Compteur incrémenté à chaque changement d'état. */
  seq: number;
  /** Secrets serveur : ne jamais transmettre. */
  rng: RngState;
  idRng: RngState;
}

// ---------------------------------------------------------------- Actions

export interface EffectParams {
  ownCardId?: CardId;
  targetPlayerId?: PlayerId;
  targetCardId?: CardId;
  cardId?: CardId;
}

export type Action =
  | { type: 'lookInitial'; cardId: CardId }
  | { type: 'ready' }
  | { type: 'callMabrouk' }
  | { type: 'takeDiscard'; cardId: CardId }
  | { type: 'draw' }
  | { type: 'swapHeld'; cardId: CardId }
  | { type: 'discardHeld' }
  | { type: 'useEffect'; params: EffectParams }
  | { type: 'skipEffect' }
  | { type: 'confirmPeek' }
  | { type: 'matchDiscard'; cardId: CardId }
  | { type: 'moveCard'; cardId: CardId; x: number; y: number }
  | { type: 'nextRound' };

export type ActionType = Action['type'];

export interface ActionContext {
  now: number;
}

export interface GameEvent {
  /** 'all' = public ; sinon liste des joueurs autorisés à recevoir l'évènement. */
  to: 'all' | PlayerId[];
  type: string;
  data: Record<string, unknown>;
}

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: string };

export interface AvailableActions {
  canLookInitial: boolean;
  canReady: boolean;
  canCallMabrouk: boolean;
  canTakeDiscard: boolean;
  canDraw: boolean;
  canSwapHeld: boolean;
  canDiscardHeld: boolean;
  /** Identifiant de l'effet utilisable, sinon null. */
  canUseEffect: EffectId | null;
  canSkipEffect: boolean;
  canConfirmPeek: boolean;
  canMatchDiscard: boolean;
  canMoveCards: boolean;
  canNextRound: boolean;
}
