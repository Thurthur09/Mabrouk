// Salon : lobby, bots, vote d'exclusion, reconnexion, diffusion des vues filtrées.
// Le Room est la seule autorité : les clients n'envoient que des demandes.
import { EasyBot } from './ai';
import { makeConfig } from './config';
import { applyAction, createGame, removePlayer } from './engine';
import type { Profile, RoomSettings, RoomView, SeatView, ServerMsg } from './protocol';
import type { Action, GameEvent, GameState, PlayerId } from './types';
import { getPlayerView } from './views';

export interface RoomDeps {
  now(): number;
  schedule(fn: () => void, ms: number): void;
  /** n entiers 32 bits aléatoires (côté serveur uniquement). */
  rand32(n: number): number[];
  /** Envoie un message au joueur (s'il est connecté). */
  send(playerId: PlayerId, msg: ServerMsg): void;
}

interface Seat {
  id: PlayerId;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  token: string;
  connected: boolean;
  kicked: boolean;
}

/** Avatars image (client/public/avatars/N.jpg), référencés sous la forme « img:N ». */
export const BOT_AVATARS = ['img:2', 'img:5', 'img:3', 'img:6', 'img:4', 'img:1'];
export const BOT_COLORS = ['#f59e0b', '#22c55e', '#ec4899', '#38bdf8', '#a78bfa'];

function hex(nums: number[]): string {
  return nums.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}

export function sanitizeProfile(p: Partial<Profile> | undefined): Profile {
  const name = String(p?.name ?? '').trim().slice(0, 16) || 'Joueur';
  const avatar = String(p?.avatar ?? '🙂').slice(0, 8) || '🙂';
  const color = /^#[0-9a-fA-F]{6}$/.test(String(p?.color ?? '')) ? String(p?.color) : '#7c9cff';
  return { name, avatar, color };
}

export class Room {
  readonly code: string;
  hostId: PlayerId = '';
  settings: RoomSettings = { targetScore: 50, maxPlayers: 6 };
  seats: Seat[] = [];
  status: 'lobby' | 'playing' | 'ended' = 'lobby';
  game: GameState | null = null;
  private kickVotes = new Map<PlayerId, Set<PlayerId>>();
  private bots = new Map<PlayerId, EasyBot>();
  private botBusy = new Set<PlayerId>();
  private botFailedAt = new Map<PlayerId, number>();

  constructor(
    code: string,
    private deps: RoomDeps,
  ) {
    this.code = code;
  }

  // ------------------------------------------------------------ Lobby

  private humans(): Seat[] {
    return this.seats.filter((s) => !s.isBot && !s.kicked);
  }

  private liveSeats(): Seat[] {
    return this.seats.filter((s) => !s.kicked);
  }

  addHuman(profile: Profile): Seat | string {
    if (this.status !== 'lobby') return 'La partie a déjà commencé.';
    if (this.liveSeats().length >= this.settings.maxPlayers) return 'Le salon est plein.';
    const id = 'p' + hex(this.deps.rand32(2));
    const seat: Seat = {
      id,
      ...sanitizeProfile(profile),
      isBot: false,
      token: hex(this.deps.rand32(4)),
      connected: true,
      kicked: false,
    };
    this.seats.push(seat);
    if (!this.hostId) this.hostId = id;
    return seat;
  }

  addBot(requesterId: PlayerId): string | null {
    if (requesterId !== this.hostId) return "Seul l'hôte peut ajouter des bots.";
    if (this.status === 'playing') return 'La partie a déjà commencé.';
    if (this.liveSeats().length >= this.settings.maxPlayers) return 'Le salon est plein.';
    const n = this.seats.filter((s) => s.isBot).length;
    const id = 'b' + hex(this.deps.rand32(2));
    const used = new Set(this.liveSeats().map((s) => s.avatar));
    const avatar = BOT_AVATARS.find((a) => !used.has(a)) ?? BOT_AVATARS[n % BOT_AVATARS.length];
    this.seats.push({
      id,
      name: `Bot ${n + 1}`,
      avatar,
      color: BOT_COLORS[n % BOT_COLORS.length],
      isBot: true,
      token: '',
      connected: true,
      kicked: false,
    });
    return null;
  }

  removeBot(requesterId: PlayerId, botId: PlayerId): string | null {
    if (requesterId !== this.hostId) return "Seul l'hôte peut retirer des bots.";
    if (this.status === 'playing') return 'La partie a déjà commencé.';
    const seat = this.seats.find((s) => s.id === botId && s.isBot);
    if (!seat) return 'Bot introuvable.';
    this.seats = this.seats.filter((s) => s !== seat);
    return null;
  }

  updateSettings(requesterId: PlayerId, s: Partial<RoomSettings>): string | null {
    if (requesterId !== this.hostId) return "Seul l'hôte peut modifier les paramètres.";
    if (this.status === 'playing') return 'La partie a déjà commencé.';
    if (s.targetScore !== undefined) {
      const t = Math.floor(Number(s.targetScore));
      if (!Number.isFinite(t) || t < 5 || t > 1000) return 'Le seuil doit être compris entre 5 et 1000.';
      this.settings.targetScore = t;
    }
    if (s.maxPlayers !== undefined) {
      const m = Math.floor(Number(s.maxPlayers));
      if (!Number.isFinite(m) || m < 2 || m > 6) return 'Le nombre de joueurs doit être compris entre 2 et 6.';
      if (m < this.liveSeats().length) return 'Il y a déjà plus de joueurs que cette limite.';
      this.settings.maxPlayers = m;
    }
    return null;
  }

  updateProfile(playerId: PlayerId, profile: Profile): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat || seat.isBot) return;
    if (this.status === 'playing') return; // l'identité visuelle est figée en cours de partie
    Object.assign(seat, sanitizeProfile(profile));
  }

  start(requesterId: PlayerId): string | null {
    if (requesterId !== this.hostId) return "Seul l'hôte peut lancer la partie.";
    if (this.status === 'playing') return 'La partie est déjà en cours.';
    const seats = this.liveSeats();
    if (seats.length < 2) return 'Il faut au moins 2 joueurs (ajoutez un bot).';
    this.game = createGame(
      makeConfig({ targetScore: this.settings.targetScore }),
      seats.map((s) => ({ id: s.id, name: s.name, avatar: s.avatar, color: s.color, isBot: s.isBot })),
      this.deps.rand32(8),
    );
    this.status = 'playing';
    this.kickVotes.clear();
    this.botFailedAt.clear();
    this.bots.clear();
    for (const s of seats) {
      if (s.isBot) this.bots.set(s.id, new EasyBot(s.id, () => this.deps.rand32(1)[0] / 4294967296));
    }
    this.afterChange([]);
    return null;
  }

  // ------------------------------------------------------------ Connexions

  connect(playerId: PlayerId): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (seat) seat.connected = true;
    this.broadcast();
  }

  findByToken(token: string): Seat | undefined {
    return token ? this.seats.find((s) => !s.isBot && !s.kicked && s.token === token) : undefined;
  }

  /** Déconnexion : en salon on libère la place, en partie on conserve tout (reconnexion possible). */
  disconnect(playerId: PlayerId): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    if (this.status === 'lobby') {
      this.seats = this.seats.filter((s) => s !== seat);
      if (this.hostId === playerId) this.hostId = this.humans()[0]?.id ?? '';
      this.dropVotesFor(playerId);
    } else {
      seat.connected = false;
      this.reevaluateKicks();
    }
    this.broadcast();
  }

  hasConnectedHumans(): boolean {
    return this.humans().some((s) => s.connected);
  }

  // ------------------------------------------------------------ Actions de jeu

  act(playerId: PlayerId, action: Action): string | null {
    if (this.status !== 'playing' || !this.game) return "Aucune partie en cours.";
    const res = applyAction(this.game, playerId, action, { now: this.deps.now() });
    if (!res.ok) return res.error;
    this.game = res.state;
    this.afterChange(res.events);
    return null;
  }

  private afterChange(events: GameEvent[]): void {
    if (this.game && this.game.phase === 'GAME_END') this.status = 'ended';
    this.dispatchEvents(events);
    this.broadcast();
    if (events.some((e) => e.type === 'matchFail')) {
      // rafraîchit les vues quand le marquage rouge expire
      this.deps.schedule(() => this.broadcast(), (this.game?.config.penaltyRevealMs ?? 5000) + 60);
    }
    this.botLoop();
  }

  // ------------------------------------------------------------ Exclusion

  voteKick(voterId: PlayerId, targetId: PlayerId): string | null {
    if (this.status !== 'playing' || !this.game) return "Aucune partie en cours.";
    const voter = this.seats.find((s) => s.id === voterId && !s.isBot && !s.kicked);
    const target = this.seats.find((s) => s.id === targetId && !s.isBot && !s.kicked);
    if (!voter || !target) return 'Joueur introuvable.';
    if (voterId === targetId) return 'Vous ne pouvez pas voter contre vous-même.';
    if (!this.game.players.find((p) => p.id === voterId && p.status === 'active')) return 'Vous ne participez plus à la partie.';
    if (!this.game.players.find((p) => p.id === targetId && p.status === 'active')) return 'Ce joueur est déjà exclu.';
    if (!this.kickVotes.has(targetId)) this.kickVotes.set(targetId, new Set());
    this.kickVotes.get(targetId)!.add(voterId);
    this.reevaluateKicks();
    this.broadcast();
    return null;
  }

  cancelKick(voterId: PlayerId, targetId: PlayerId): void {
    this.kickVotes.get(targetId)?.delete(voterId);
    if (this.kickVotes.get(targetId)?.size === 0) this.kickVotes.delete(targetId);
    this.broadcast();
  }

  /** Emote éphémère (aucun état conservé) : diffusé à tous les humains connectés en partie. */
  emote(playerId: PlayerId, emote: string): void {
    if (this.status !== 'playing') return;
    if (!this.seats.find((s) => s.id === playerId && !s.kicked)) return;
    const e = String(emote ?? '').slice(0, 8);
    if (!e) return;
    for (const s of this.humans()) {
      if (s.connected) this.deps.send(s.id, { t: 'emote', playerId, emote: e });
    }
  }

  private dropVotesFor(playerId: PlayerId): void {
    this.kickVotes.delete(playerId);
    for (const v of this.kickVotes.values()) v.delete(playerId);
  }

  /** Exclusion si TOUS les autres joueurs humains connectés ont voté. Les bots ne votent pas. */
  private reevaluateKicks(): void {
    if (!this.game || this.status !== 'playing') return;
    for (const [targetId, votes] of [...this.kickVotes.entries()]) {
      const required = this.humans().filter(
        (s) => s.id !== targetId && s.connected && this.game!.players.find((p) => p.id === s.id)?.status === 'active',
      );
      if (required.length === 0 || !required.every((s) => votes.has(s.id))) continue;
      const res = removePlayer(this.game, targetId, { now: this.deps.now() });
      if (!res.ok) {
        this.kickVotes.delete(targetId);
        continue;
      }
      this.game = res.state;
      const seat = this.seats.find((s) => s.id === targetId)!;
      seat.kicked = true;
      seat.connected = false;
      this.dropVotesFor(targetId);
      this.deps.send(targetId, { t: 'kicked' });
      if (this.hostId === targetId) this.hostId = this.humans()[0]?.id ?? '';
      if (this.game.phase === 'GAME_END') this.status = 'ended';
      this.dispatchEvents(res.events);
      this.broadcast();
      this.botLoop();
      return this.reevaluateKicks();
    }
  }

  // ------------------------------------------------------------ Diffusion

  seatViews(): SeatView[] {
    return this.liveSeats().map((s) => ({
      id: s.id,
      name: s.name,
      avatar: s.avatar,
      color: s.color,
      isBot: s.isBot,
      connected: s.connected,
      isHost: s.id === this.hostId,
    }));
  }

  roomView(playerId: PlayerId): RoomView {
    const kickVotes: Record<PlayerId, PlayerId[]> = {};
    for (const [t, v] of this.kickVotes) kickVotes[t] = [...v];
    return {
      code: this.code,
      status: this.status,
      hostId: this.hostId,
      you: playerId,
      settings: { ...this.settings },
      seats: this.seatViews(),
      kickVotes,
      game: this.game ? getPlayerView(this.game, playerId, this.deps.now()) : null,
    };
  }

  broadcast(): void {
    for (const s of this.humans()) {
      if (s.connected) this.deps.send(s.id, { t: 'state', room: this.roomView(s.id) });
    }
  }

  private dispatchEvents(events: GameEvent[]): void {
    if (!events.length) return;
    for (const s of this.humans()) {
      if (!s.connected) continue;
      const mine = events.filter((e) => e.to === 'all' || e.to.includes(s.id));
      if (mine.length) this.deps.send(s.id, { t: 'events', events: mine });
    }
  }

  // ------------------------------------------------------------ Bots

  private botLoop(): void {
    const game = this.game;
    if (this.status !== 'playing' || !game) return;
    for (const [id, brain] of this.bots) {
      if (this.botBusy.has(id)) continue;
      const p = game.players.find((x) => x.id === id);
      if (!p || p.status !== 'active') continue;
      if (this.botFailedAt.get(id) === game.seq) continue;
      const decision = brain.decide(getPlayerView(game, id, this.deps.now()));
      if (!decision) continue;
      this.botBusy.add(id);
      const seq = game.seq;
      this.deps.schedule(() => {
        this.botBusy.delete(id);
        if (this.status !== 'playing' || !this.game) return;
        if (this.game.seq !== seq) {
          this.botLoop();
          return;
        }
        const err = this.act(id, decision.action);
        if (err) {
          this.botFailedAt.set(id, seq);
          this.botLoop();
        }
      }, decision.delayMs);
    }
  }
}
