// NETWORKING (logique) : routage des messages d'un transport (WebSocket ou local) vers les salons.
// Indépendant du transport : le serveur Node et le mode solo navigateur utilisent ce même Hub.
import type { ClientMsg, ServerMsg } from './protocol';
import { Room, sanitizeProfile } from './room';
import type { RoomDeps } from './room';
import type { PlayerId } from './types';

export type ConnId = string;

export interface HubDeps {
  now(): number;
  schedule(fn: () => void, ms: number): void;
  rand32(n: number): number[];
  sendConn(connId: ConnId, msg: ServerMsg): void;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class Hub {
  private rooms = new Map<string, Room>();
  private conns = new Map<ConnId, { room: Room; playerId: PlayerId }>();
  /** `${code}:${playerId}` -> connexion courante */
  private bindings = new Map<string, ConnId>();

  constructor(private deps: HubDeps) {}

  private newCode(): string {
    for (;;) {
      const nums = this.deps.rand32(5);
      const code = nums.map((n) => CODE_CHARS[(n >>> 0) % CODE_CHARS.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }

  private roomDeps(code: string): RoomDeps {
    return {
      now: this.deps.now,
      schedule: this.deps.schedule,
      rand32: this.deps.rand32,
      send: (playerId, msg) => {
        const conn = this.bindings.get(`${code}:${playerId}`);
        if (conn) this.deps.sendConn(conn, msg);
      },
    };
  }

  private bind(connId: ConnId, room: Room, playerId: PlayerId): void {
    this.unbind(connId, false);
    const old = this.bindings.get(`${room.code}:${playerId}`);
    if (old && old !== connId) this.conns.delete(old);
    this.bindings.set(`${room.code}:${playerId}`, connId);
    this.conns.set(connId, { room, playerId });
  }

  private unbind(connId: ConnId, notifyRoom: boolean): void {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    const key = `${c.room.code}:${c.playerId}`;
    if (this.bindings.get(key) === connId) {
      this.bindings.delete(key);
      if (notifyRoom) c.room.disconnect(c.playerId);
    }
    if (!c.room.hasConnectedHumans() && c.room.status === 'lobby') this.rooms.delete(c.room.code);
    else if (!c.room.hasConnectedHumans() && c.room.seats.every((s) => s.isBot || !s.connected)) {
      // Partie abandonnée par tous : on la garde un moment pour la reconnexion.
      this.deps.schedule(() => {
        if (!c.room.hasConnectedHumans()) this.rooms.delete(c.room.code);
      }, 30 * 60 * 1000);
    }
  }

  private err(connId: ConnId, message: string): void {
    this.deps.sendConn(connId, { t: 'error', message });
  }

  handle(connId: ConnId, msg: ClientMsg): void {
    try {
      this.route(connId, msg);
    } catch (e) {
      this.err(connId, 'Erreur interne : ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  private route(connId: ConnId, msg: ClientMsg): void {
    if (!msg || typeof msg.t !== 'string') return this.err(connId, 'Message invalide.');

    if (msg.t === 'createRoom') {
      if (this.conns.has(connId)) this.unbind(connId, true);
      const code = this.newCode();
      const real = new Room(code, this.roomDeps(code));
      this.rooms.set(code, real);
      const seat = real.addHuman(sanitizeProfile(msg.profile));
      if (typeof seat === 'string') return this.err(connId, seat);
      real.updateSettings(seat.id, msg.settings ?? {});
      this.bind(connId, real, seat.id);
      this.deps.sendConn(connId, { t: 'joined', code: real.code, playerId: seat.id, token: seat.token });
      if (msg.solo) {
        const bots = Math.min(5, Math.max(1, Math.floor(msg.solo.bots)));
        for (let i = 0; i < bots; i++) real.addBot(seat.id);
        const e = real.start(seat.id);
        if (e) return this.err(connId, e);
      } else {
        real.broadcast();
      }
      return;
    }

    if (msg.t === 'joinRoom') {
      const room = this.rooms.get(String(msg.code ?? '').toUpperCase().trim());
      if (!room) return this.err(connId, 'Salon introuvable.');
      if (this.conns.has(connId)) this.unbind(connId, true);
      const seat = room.addHuman(sanitizeProfile(msg.profile));
      if (typeof seat === 'string') return this.err(connId, seat);
      this.bind(connId, room, seat.id);
      this.deps.sendConn(connId, { t: 'joined', code: room.code, playerId: seat.id, token: seat.token });
      room.broadcast();
      return;
    }

    if (msg.t === 'resume') {
      const room = this.rooms.get(String(msg.code ?? '').toUpperCase().trim());
      const seat = room?.findByToken(String(msg.token ?? ''));
      if (!room || !seat) return this.err(connId, 'Reconnexion impossible : partie ou place introuvable.');
      this.bind(connId, room, seat.id);
      this.deps.sendConn(connId, { t: 'joined', code: room.code, playerId: seat.id, token: seat.token });
      room.connect(seat.id);
      return;
    }

    const c = this.conns.get(connId);
    if (!c) return this.err(connId, "Vous n'êtes dans aucun salon.");
    const { room, playerId } = c;

    switch (msg.t) {
      case 'profile':
        room.updateProfile(playerId, msg.profile);
        room.broadcast();
        return;
      case 'settings': {
        const e = room.updateSettings(playerId, msg.settings ?? {});
        if (e) return this.err(connId, e);
        room.broadcast();
        return;
      }
      case 'addBot': {
        const e = room.addBot(playerId);
        if (e) return this.err(connId, e);
        room.broadcast();
        return;
      }
      case 'removeBot': {
        const e = room.removeBot(playerId, msg.id);
        if (e) return this.err(connId, e);
        room.broadcast();
        return;
      }
      case 'start': {
        const e = room.start(playerId);
        if (e) this.err(connId, e);
        return;
      }
      case 'action': {
        const e = room.act(playerId, msg.action);
        if (e) this.err(connId, e);
        return;
      }
      case 'voteKick': {
        const e = room.voteKick(playerId, msg.target);
        if (e) this.err(connId, e);
        return;
      }
      case 'cancelKick':
        room.cancelKick(playerId, msg.target);
        return;
      case 'emote':
        room.emote(playerId, msg.emote);
        return;
      case 'leave':
        this.unbind(connId, true);
        this.deps.sendConn(connId, { t: 'left' });
        return;
    }
  }

  disconnect(connId: ConnId): void {
    this.unbind(connId, true);
  }

  roomCount(): number {
    return this.rooms.size;
  }
}
