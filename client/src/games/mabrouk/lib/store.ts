// Client : store + transports. Le client n'applique AUCUNE règle : il envoie des demandes et affiche
// les vues que le serveur (ou le Hub local en solo) lui renvoie.
import { useSyncExternalStore } from 'react';
import { Hub } from '@mabrouk/core';
import type { Action, ClientMsg, GameEvent, Profile, RoomSettings, RoomView, ServerMsg } from '@mabrouk/core';
import { describeEvent } from './describe';
import { play } from './sound';

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'good' | 'bad';
}

export interface LogLine {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

export interface ClientState {
  mode: 'remote' | 'local' | null;
  link: 'idle' | 'connecting' | 'online' | 'offline';
  session: Session | null;
  room: RoomView | null;
  log: LogLine[];
  toasts: Toast[];
  kicked: boolean;
}

const SESSION_KEY = 'mabrouk.session';
let state: ClientState = { mode: null, link: 'idle', session: null, room: null, log: [], toasts: [], kicked: false };
const listeners = new Set<() => void>();
const eventListeners = new Set<(events: GameEvent[], room: RoomView | null) => void>();
const emoteListeners = new Set<(playerId: string, emote: string) => void>();
let uid = 1;

function set(patch: Partial<ClientState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useClient(): ClientState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function onGameEvents(cb: (events: GameEvent[], room: RoomView | null) => void): () => void {
  eventListeners.add(cb);
  return () => eventListeners.delete(cb);
}

export function onEmotes(cb: (playerId: string, emote: string) => void): () => void {
  emoteListeners.add(cb);
  return () => emoteListeners.delete(cb);
}

function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t = { id: uid++, text, kind };
  set({ toasts: [...state.toasts.slice(-3), t] });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), 3200);
}

// ------------------------------------------------------------------ Transports

interface Transport {
  send(msg: ClientMsg): void;
  close(): void;
}

let transport: Transport | null = null;

function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function savedSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function crypto32(n: number): number[] {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a);
}

/** Solo : le même Hub que le serveur, exécuté dans le navigateur. */
function makeLocal(): Transport {
  const hub = new Hub({
    now: () => Date.now(),
    schedule: (fn, ms) => void setTimeout(fn, ms),
    rand32: crypto32,
    sendConn: (_c, msg) => handleServer(msg),
  });
  return {
    send: (msg) => hub.handle('local', msg),
    close: () => hub.disconnect('local'),
  };
}

function serverUrl(): string {
  const custom = new URLSearchParams(location.search).get('server') ?? localStorage.getItem('mabrouk.server');
  if (custom) return custom;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function makeRemote(first: ClientMsg | null): Transport {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const queue: ClientMsg[] = first ? [first] : [];

  const open = () => {
    set({ link: 'connecting' });
    try {
      ws = new WebSocket(serverUrl());
    } catch {
      set({ link: 'offline' });
      return;
    }
    ws.onopen = () => {
      set({ link: 'online' });
      const s = state.session;
      if (s && !queue.length) ws!.send(JSON.stringify({ t: 'resume', code: s.code, token: s.token } satisfies ClientMsg));
      while (queue.length) ws!.send(JSON.stringify(queue.shift()));
    };
    ws.onmessage = (ev) => {
      try {
        handleServer(JSON.parse(String(ev.data)) as ServerMsg);
      } catch {
        /* message ignoré */
      }
    };
    ws.onclose = () => {
      if (closed) return;
      set({ link: 'offline' });
      retry = setTimeout(open, 1500);
    };
    ws.onerror = () => ws?.close();
  };
  open();
  return {
    send: (msg) => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      else queue.push(msg);
    },
    close: () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    },
  };
}

// ------------------------------------------------------------------ Messages du serveur

function handleServer(msg: ServerMsg): void {
  switch (msg.t) {
    case 'joined': {
      const session = { code: msg.code, playerId: msg.playerId, token: msg.token };
      set({ session });
      if (state.mode === 'remote') saveSession(session);
      return;
    }
    case 'state':
      set({ room: msg.room });
      return;
    case 'events': {
      const room = state.room;
      const me = state.session?.playerId ?? '';
      const name = (id: string) => room?.game?.players.find((p) => p.id === id)?.name ?? room?.seats.find((s) => s.id === id)?.name ?? '?';
      const lines: LogLine[] = [];
      for (const e of msg.events) {
        const text = describeEvent(e, name, me);
        if (text) lines.push({ id: uid++, text, kind: e.type === 'matchFail' || e.type === 'penaltyDraw' ? 'bad' : e.type === 'matchOk' || e.type === 'mabrouk' ? 'good' : 'info' });
      }
      if (lines.length) set({ log: [...state.log, ...lines].slice(-40) });
      eventListeners.forEach((l) => l(msg.events, state.room));
      return;
    }
    case 'error':
      toast(msg.message, 'error');
      play('error');
      if (/Reconnexion impossible/.test(msg.message)) {
        saveSession(null);
        set({ session: null, room: null });
      }
      return;
    case 'emote':
      emoteListeners.forEach((l) => l(msg.playerId, msg.emote));
      return;
    case 'kicked':
      saveSession(null);
      transport?.close();
      transport = null;
      set({ kicked: true, room: null, session: null, link: 'idle', mode: null });
      return;
    case 'left':
      return;
  }
}

// ------------------------------------------------------------------ API pour l'UI

function reset(): void {
  transport?.close();
  transport = null;
  saveSession(null);
  set({ mode: null, link: 'idle', session: null, room: null, log: [], kicked: false });
}

export const api = {
  acknowledgeKick(): void {
    set({ kicked: false });
  },
  startSolo(profile: Profile, bots: number, targetScore: number): void {
    reset();
    set({ mode: 'local', link: 'online' });
    transport = makeLocal();
    transport.send({ t: 'createRoom', profile, solo: { bots }, settings: { targetScore } });
  },
  createOnline(profile: Profile, settings: Partial<RoomSettings>): void {
    reset();
    set({ mode: 'remote' });
    transport = makeRemote({ t: 'createRoom', profile, settings });
  },
  joinOnline(code: string, profile: Profile): void {
    reset();
    set({ mode: 'remote' });
    transport = makeRemote({ t: 'joinRoom', code, profile });
  },
  resume(): void {
    const s = savedSession();
    if (!s || transport) return;
    set({ mode: 'remote', session: s });
    transport = makeRemote(null);
  },
  send(msg: ClientMsg): void {
    transport?.send(msg);
  },
  action(action: Action): void {
    transport?.send({ t: 'action', action });
  },
  emote(emote: string): void {
    transport?.send({ t: 'emote', emote });
  },
  leave(): void {
    transport?.send({ t: 'leave' });
    reset();
  },
};
