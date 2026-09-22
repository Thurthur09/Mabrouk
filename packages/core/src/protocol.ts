// Protocole client <-> serveur (identique en ligne et en solo local).
import type { GameView } from './views';
import type { Action, GameEvent, PlayerId } from './types';

export interface Profile {
  name: string;
  avatar: string;
  color: string;
}

export interface RoomSettings {
  targetScore: number;
  maxPlayers: number;
}

export interface SeatView {
  id: PlayerId;
  name: string;
  avatar: string;
  color: string;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface RoomView {
  code: string;
  status: 'lobby' | 'playing' | 'ended';
  hostId: PlayerId;
  you: PlayerId;
  settings: RoomSettings;
  seats: SeatView[];
  /** Votes d'exclusion en cours : cible -> votants. */
  kickVotes: Record<PlayerId, PlayerId[]>;
  game: GameView | null;
}

export type ClientMsg =
  | { t: 'createRoom'; profile: Profile; settings?: Partial<RoomSettings>; solo?: { bots: number } }
  | { t: 'joinRoom'; code: string; profile: Profile }
  | { t: 'resume'; code: string; token: string }
  | { t: 'profile'; profile: Profile }
  | { t: 'settings'; settings: Partial<RoomSettings> }
  | { t: 'addBot' }
  | { t: 'removeBot'; id: PlayerId }
  | { t: 'start' }
  | { t: 'action'; action: Action }
  | { t: 'voteKick'; target: PlayerId }
  | { t: 'cancelKick'; target: PlayerId }
  | { t: 'emote'; emote: string }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'joined'; code: string; playerId: PlayerId; token: string }
  | { t: 'state'; room: RoomView }
  | { t: 'events'; events: GameEvent[] }
  | { t: 'error'; message: string }
  | { t: 'kicked' }
  | { t: 'left' }
  | { t: 'emote'; playerId: PlayerId; emote: string };
