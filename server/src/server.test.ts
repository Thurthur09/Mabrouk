import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ClientMsg, ServerMsg } from '@mabrouk/core';
import { startServer } from './server';

let srv: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => {
  srv = await startServer({ port: 0 });
});
afterAll(async () => {
  await srv.close();
});

function client() {
  const ws = new WebSocket(`ws://localhost:${srv.port}/ws`);
  const msgs: ServerMsg[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const open = new Promise<void>((r) => ws.on('open', () => r()));
  const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
  const wait = async (pred: (m: ServerMsg) => boolean, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const f = msgs.find(pred);
      if (f) return f;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout');
  };
  return { ws, msgs, open, send, wait };
}

describe('serveur WebSocket', () => {
  it('crée un salon, fait rejoindre un second joueur, lance la partie et reconnecte avec le jeton', async () => {
    const a = client();
    const b = client();
    await Promise.all([a.open, b.open]);
    a.send({ t: 'createRoom', profile: { name: 'A', avatar: '🦊', color: '#ff0000' } });
    const ja = (await a.wait((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>;
    b.send({ t: 'joinRoom', code: ja.code, profile: { name: 'B', avatar: '🐼', color: '#00ff00' } });
    const jb = (await b.wait((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>;
    a.send({ t: 'start' });
    const st = (await b.wait((m) => m.t === 'state' && m.room.status === 'playing')) as Extract<ServerMsg, { t: 'state' }>;
    const other = st.room.game!.players.find((p) => p.id === ja.playerId)!;
    expect(other.hand.every((c) => c.face === null)).toBe(true);
    // coupure puis reconnexion
    b.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const b2 = client();
    await b2.open;
    b2.send({ t: 'resume', code: jb.code, token: jb.token });
    const back = (await b2.wait((m) => m.t === 'state')) as Extract<ServerMsg, { t: 'state' }>;
    expect(back.room.you).toBe(jb.playerId);
    expect(back.room.game!.players.find((p) => p.id === jb.playerId)!.hand).toHaveLength(4);
    a.ws.close();
    b2.ws.close();
  });

  it('ignore les messages illisibles sans planter', async () => {
    const a = client();
    await a.open;
    a.ws.send('pas du json');
    await a.wait((m) => m.t === 'error');
    a.send({ t: 'action', action: { type: 'draw' } });
    await a.wait((m) => m.t === 'error' && /aucun salon/i.test(m.message));
    a.ws.close();
  });
});
