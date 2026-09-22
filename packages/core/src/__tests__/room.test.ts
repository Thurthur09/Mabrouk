import { describe, expect, it } from 'vitest';
import { EasyBot } from '../ai';
import { Hub } from '../hub';
import type { ClientMsg, RoomView, ServerMsg } from '../protocol';
import type { GameView } from '../views';

const PROFILE = { name: 'Alice', avatar: '🦊', color: '#ff8800' };

function makeEnv(seed = 1) {
  let t = 1_000_000;
  let counter = 0;
  const queue: { at: number; id: number; fn: () => void }[] = [];
  let s = seed >>> 0;
  const rand = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return (x ^ (x >>> 14)) >>> 0;
  };
  const inbox = new Map<string, ServerMsg[]>();
  const listeners = new Map<string, (m: ServerMsg) => void>();
  const hub = new Hub({
    now: () => t,
    schedule: (fn, ms) => queue.push({ at: t + ms, id: counter++, fn }),
    rand32: (n) => Array.from({ length: n }, rand),
    sendConn: (c, m) => {
      if (!inbox.has(c)) inbox.set(c, []);
      inbox.get(c)!.push(m);
      listeners.get(c)?.(m);
    },
  });
  const env = {
    hub,
    inbox,
    now: () => t,
    schedule: (fn: () => void, ms: number) => queue.push({ at: t + ms, id: counter++, fn }),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (!next || next.at > end) break;
        queue.shift();
        t = next.at;
        next.fn();
      }
      t = end;
    },
    send: (c: string, m: ClientMsg) => hub.handle(c, m),
    listen: (c: string, fn: (m: ServerMsg) => void) => listeners.set(c, fn),
    msgs: (c: string) => inbox.get(c) ?? [],
    room: (c: string): RoomView => {
      const st = [...(inbox.get(c) ?? [])].reverse().find((m) => m.t === 'state');
      if (!st || st.t !== 'state') throw new Error('pas de state pour ' + c);
      return st.room;
    },
    errors: (c: string) => (inbox.get(c) ?? []).filter((m) => m.t === 'error'),
    joined: (c: string) => {
      const j = [...(inbox.get(c) ?? [])].reverse().find((m) => m.t === 'joined');
      if (!j || j.t !== 'joined') throw new Error('pas de joined pour ' + c);
      return j;
    },
  };
  return env;
}

/** Fait jouer une connexion « humaine » par le bot Facile, en utilisant uniquement sa vue. */
function attachAgent(env: ReturnType<typeof makeEnv>, conn: string, playerId: string) {
  const brain = new EasyBot(playerId, () => 0.5);
  let pending = false;
  let last: GameView | null = null;
  const think = () => {
    if (pending || !last) return;
    const d = brain.decide(last);
    if (!d) return;
    pending = true;
    env.schedule(() => {
      pending = false;
      env.send(conn, { t: 'action', action: d.action });
    }, d.delayMs);
  };
  env.listen(conn, (m) => {
    if (m.t === 'state' && m.room.game) {
      last = m.room.game;
      think();
    } else if (m.t === 'error') think();
  });
}

function humans(env: ReturnType<typeof makeEnv>, n: number, settings = {}) {
  env.send('c1', { t: 'createRoom', profile: { ...PROFILE, name: 'A' }, settings });
  const code = env.joined('c1').code;
  for (let i = 2; i <= n; i++) env.send('c' + i, { t: 'joinRoom', code, profile: { ...PROFILE, name: 'J' + i } });
  return code;
}

describe('salon et lobby', () => {
  it('crée un salon, fait rejoindre des joueurs et applique les réglages de l\'hôte', () => {
    const env = makeEnv();
    const code = humans(env, 3);
    const v = env.room('c3');
    expect(v.code).toBe(code);
    expect(v.seats).toHaveLength(3);
    expect(v.seats.find((s) => s.isHost)!.name).toBe('A');
    env.send('c1', { t: 'settings', settings: { targetScore: 80 } });
    expect(env.room('c2').settings.targetScore).toBe(80);
    env.send('c2', { t: 'settings', settings: { targetScore: 10 } });
    expect(env.errors('c2')).toHaveLength(1);
    expect(env.room('c2').settings.targetScore).toBe(80);
    env.send('c1', { t: 'settings', settings: { targetScore: 2 } });
    expect(env.errors('c1')).toHaveLength(1);
    env.send('c1', { t: 'settings', settings: { maxPlayers: 9 } });
    expect(env.errors('c1')).toHaveLength(2);
    env.send('c1', { t: 'settings', settings: { maxPlayers: 2 } });
    expect(env.errors('c1')).toHaveLength(3); // déjà 3 joueurs
  });

  it('refuse un salon inconnu, un salon plein et un lancement à 1 joueur', () => {
    const env = makeEnv();
    env.send('c9', { t: 'joinRoom', code: 'ZZZZZ', profile: PROFILE });
    expect(env.errors('c9')).toHaveLength(1);
    env.send('c1', { t: 'createRoom', profile: PROFILE, settings: { maxPlayers: 2 } });
    const code = env.joined('c1').code;
    env.send('c1', { t: 'start' });
    expect(env.errors('c1')).toHaveLength(1);
    env.send('c2', { t: 'joinRoom', code, profile: PROFILE });
    env.send('c3', { t: 'joinRoom', code, profile: PROFILE });
    expect(env.errors('c3')).toHaveLength(1);
  });

  it("seul l'hôte lance la partie ; on ne rejoint plus une partie en cours", () => {
    const env = makeEnv();
    const code = humans(env, 2);
    env.send('c2', { t: 'start' });
    expect(env.errors('c2')).toHaveLength(1);
    env.send('c1', { t: 'start' });
    expect(env.room('c1').status).toBe('playing');
    env.send('c3', { t: 'joinRoom', code, profile: PROFILE });
    expect(env.errors('c3')).toHaveLength(1);
  });

  it('assainit le profil (nom, couleur) et permet la personnalisation rapide', () => {
    const env = makeEnv();
    env.send('c1', { t: 'createRoom', profile: { name: '   ', avatar: '🐼', color: 'javascript:alert(1)' } });
    const me = env.room('c1').seats[0];
    expect(me.name).toBe('Joueur');
    expect(me.color).toBe('#7c9cff');
    env.send('c1', { t: 'profile', profile: { name: 'Zoé', avatar: '🐸', color: '#22c55e' } });
    expect(env.room('c1').seats[0]).toMatchObject({ name: 'Zoé', avatar: '🐸', color: '#22c55e' });
  });

  it("ajoute et retire des bots (hôte uniquement)", () => {
    const env = makeEnv();
    humans(env, 2);
    env.send('c2', { t: 'addBot' });
    expect(env.errors('c2')).toHaveLength(1);
    env.send('c1', { t: 'addBot' });
    const bot = env.room('c1').seats.find((s) => s.isBot)!;
    expect(bot).toBeTruthy();
    env.send('c1', { t: 'removeBot', id: bot.id });
    expect(env.room('c1').seats.some((s) => s.isBot)).toBe(false);
  });

  it('une déconnexion dans le salon libère la place ; l\'hôte est transmis', () => {
    const env = makeEnv();
    humans(env, 3);
    env.hub.disconnect('c1');
    const v = env.room('c2');
    expect(v.seats).toHaveLength(2);
    expect(v.seats.find((s) => s.isHost)!.name).toBe('J2');
  });
});

describe('solo contre bots', () => {
  it("démarre immédiatement avec les bots, sans divulguer leurs cartes", () => {
    const env = makeEnv(7);
    env.send('c1', { t: 'createRoom', profile: PROFILE, solo: { bots: 3 }, settings: { targetScore: 30 } });
    const v = env.room('c1');
    expect(v.status).toBe('playing');
    expect(v.seats.filter((s) => s.isBot)).toHaveLength(3);
    expect(v.game!.players).toHaveLength(4);
    const others = v.game!.players.filter((p) => p.id !== v.you);
    expect(others.every((p) => p.hand.every((c) => c.face === null))).toBe(true);
  });

  it("joue une partie complète jusqu'à la fin avec un « humain » automatisé, sans erreur serveur", () => {
    const env = makeEnv(11);
    env.send('c1', { t: 'createRoom', profile: PROFILE, solo: { bots: 2 }, settings: { targetScore: 15 } });
    const j = env.joined('c1');
    attachAgent(env, 'c1', j.playerId);
    env.send('c1', { t: 'profile', profile: PROFILE }); // déclenche un state => l'agent démarre
    for (let i = 0; i < 4000 && env.room('c1').status !== 'ended'; i++) env.advance(5_000);
    const v = env.room('c1');
    expect(v.status).toBe('ended');
    expect(v.game!.phase).toBe('GAME_END');
    expect(v.game!.winners!.length).toBeGreaterThan(0);
    expect(v.game!.round).toBeGreaterThanOrEqual(1);
    expect(Math.max(...v.game!.players.map((p) => p.score))).toBeGreaterThanOrEqual(15);
    expect(env.errors('c1')).toEqual([]);
  });
});

describe('réseau : confidentialité', () => {
  it("aucun message n'expose les cartes cachées d'un autre joueur pendant la partie", () => {
    const env = makeEnv(3);
    humans(env, 2);
    env.send('c1', { t: 'addBot' });
    env.send('c1', { t: 'start' });
    const [a, b] = [env.joined('c1').playerId, env.joined('c2').playerId];
    attachAgent(env, 'c1', a);
    attachAgent(env, 'c2', b);
    env.send('c1', { t: 'profile', profile: PROFILE });
    env.send('c2', { t: 'profile', profile: PROFILE });
    for (let i = 0; i < 400 && env.room('c1').status === 'playing'; i++) env.advance(5_000);
    for (const [conn, pid] of [['c1', a], ['c2', b]] as const) {
      for (const m of env.msgs(conn)) {
        if (m.t === 'state' && m.room.game) {
          const g = m.room.game;
          const open = g.phase === 'ROUND_END' || g.phase === 'GAME_END';
          for (const p of g.players) {
            if (p.id === pid || open) continue;
            for (const c of p.hand) {
              const peekedByMe = g.peek?.playerId === pid && g.peek.cardId === c.id; // effet du 9
              if (c.face && !peekedByMe) expect(c.redUntil, 'carte adverse visible hors pénalité/effet 9').not.toBeNull();
            }
          }
          if (g.held && g.held.playerId !== pid) expect(g.held.face).toBeNull();
          if (g.peek && g.peek.playerId !== pid) expect(g.peek.face).toBeNull();
        }
        if (m.t === 'events') {
          for (const e of m.events) {
            if (e.type === 'peek' || e.type === 'initialLook') expect(e.data.playerId === undefined || e.data.playerId === pid).toBe(true);
          }
        }
      }
    }
    // chaque joueur n'a reçu que ses propres évènements privés
    const privA = env.msgs('c1').flatMap((m) => (m.t === 'events' ? m.events : [])).filter((e) => e.type === 'drawPrivate').length;
    const privB = env.msgs('c2').flatMap((m) => (m.t === 'events' ? m.events : [])).filter((e) => e.type === 'drawPrivate').length;
    expect(privA + privB).toBeGreaterThan(0);
  });

  it('refuse les actions illégales et les messages mal formés sans planter ni changer l\'état', () => {
    const env = makeEnv(5);
    env.send('c1', { t: 'createRoom', profile: PROFILE, solo: { bots: 1 } });
    const before = JSON.stringify(env.room('c1').game!.players.map((p) => p.cardCount));
    env.send('c1', { t: 'action', action: { type: 'draw' } }); // pas de tour en cours / phase initiale
    env.send('c1', { t: 'action', action: { type: 'matchDiscard', cardId: 'xxx' } });
    env.send('c1', { t: 'action', action: null as never });
    env.send('c1', { t: 'nope' } as never);
    env.send('c1', null as never);
    env.send('ghost', { t: 'action', action: { type: 'draw' } });
    expect(env.errors('c1').length).toBeGreaterThanOrEqual(4);
    expect(env.errors('ghost')).toHaveLength(1);
    expect(JSON.stringify(env.room('c1').game!.players.map((p) => p.cardCount))).toBe(before);
  });
});

describe('déconnexion, reconnexion, exclusion', () => {
  function startedTrio() {
    const env = makeEnv(21);
    humans(env, 3);
    env.send('c1', { t: 'start' });
    const ids = ['c1', 'c2', 'c3'].map((c) => env.joined(c));
    return { env, ids };
  }

  it("conserve la partie, les cartes et les scores pendant une déconnexion, et l'attend indéfiniment", () => {
    const { env, ids } = startedTrio();
    const before = env.room('c2').game!.players.find((p) => p.id === ids[1].playerId)!;
    env.hub.disconnect('c2');
    env.advance(24 * 3600 * 1000);
    const v = env.room('c1');
    expect(v.status).toBe('playing');
    expect(v.seats.find((s) => s.id === ids[1].playerId)!.connected).toBe(false);
    expect(v.game!.players.find((p) => p.id === ids[1].playerId)!.status).toBe('active');
    // reconnexion avec le jeton
    env.send('c2b', { t: 'resume', code: ids[1].code, token: ids[1].token });
    const back = env.room('c2b');
    expect(back.you).toBe(ids[1].playerId);
    expect(back.seats.find((s) => s.id === ids[1].playerId)!.connected).toBe(true);
    const mine = back.game!.players.find((p) => p.id === ids[1].playerId)!;
    expect(mine.hand.map((c) => c.id)).toEqual(before.hand.map((c) => c.id));
    expect(mine.score).toBe(before.score);
    // et il ne reçoit toujours que ses informations
    for (const p of back.game!.players.filter((x) => x.id !== ids[1].playerId)) expect(p.hand.every((c) => c.face === null)).toBe(true);
  });

  it('refuse une reconnexion avec un mauvais jeton', () => {
    const { env, ids } = startedTrio();
    env.hub.disconnect('c2');
    env.send('evil', { t: 'resume', code: ids[1].code, token: 'faux' });
    expect(env.errors('evil')).toHaveLength(1);
    env.send('evil', { t: 'resume', code: ids[1].code, token: ids[0].token }); // le jeton d'un autre ne prend pas cette place
    expect(env.room('evil').you).toBe(ids[0].playerId);
  });

  it("exclut un joueur par vote unanime des autres humains, ses cartes sont écartées", () => {
    const { env, ids } = startedTrio();
    const target = ids[2].playerId;
    env.send('c1', { t: 'voteKick', target });
    expect(env.room('c1').kickVotes[target]).toEqual([ids[0].playerId]);
    expect(env.room('c1').game!.players.find((p) => p.id === target)!.status).toBe('active');
    env.send('c2', { t: 'voteKick', target });
    const g = env.room('c1').game!;
    expect(g.players.find((p) => p.id === target)!.status).toBe('removed');
    expect(env.msgs('c3').some((m) => m.t === 'kicked')).toBe(true);
    expect(env.room('c1').seats.some((s) => s.id === target)).toBe(false);
    expect(env.room('c1').kickVotes[target]).toBeUndefined();
    // le joueur exclu ne peut plus revenir
    env.send('c3b', { t: 'resume', code: ids[2].code, token: ids[2].token });
    expect(env.errors('c3b')).toHaveLength(1);
  });

  it("un vote partiel ne suffit pas, on peut le retirer, on ne vote pas contre soi", () => {
    const { env, ids } = startedTrio();
    env.send('c1', { t: 'voteKick', target: ids[1].playerId });
    env.send('c3', { t: 'voteKick', target: ids[1].playerId }); // c1 + c3 = tous les autres que c2 -> exclu
    expect(env.room('c1').game!.players.find((p) => p.id === ids[1].playerId)!.status).toBe('removed');
    const { env: e2, ids: i2 } = startedTrio();
    e2.send('c1', { t: 'voteKick', target: i2[1].playerId });
    e2.send('c1', { t: 'cancelKick', target: i2[1].playerId });
    expect(e2.room('c1').kickVotes[i2[1].playerId]).toBeUndefined();
    e2.send('c2', { t: 'voteKick', target: i2[1].playerId });
    expect(e2.errors('c2')).toHaveLength(1);
  });

  it("les bots ne votent pas : avec 1 humain + bots, personne ne peut être exclu ; un déconnecté est exclu par le seul humain restant", () => {
    const env = makeEnv(8);
    humans(env, 2);
    env.send('c1', { t: 'addBot' });
    env.send('c1', { t: 'start' });
    const [a, b] = [env.joined('c1').playerId, env.joined('c2').playerId];
    env.hub.disconnect('c2'); // c2 déconnecté : l'unique votant requis est c1
    env.send('c1', { t: 'voteKick', target: b });
    expect(env.room('c1').game!.players.find((p) => p.id === b)!.status).toBe('removed');
    env.send('c1', { t: 'voteKick', target: a });
    expect(env.errors('c1').length).toBeGreaterThan(0);
  });

  it("une partie s'arrête s'il reste moins de 2 joueurs après exclusion", () => {
    const env = makeEnv(9);
    humans(env, 2);
    env.send('c1', { t: 'start' });
    const b = env.joined('c2').playerId;
    env.send('c1', { t: 'voteKick', target: b });
    expect(env.room('c1').status).toBe('ended');
    expect(env.room('c1').game!.winners).toEqual([env.joined('c1').playerId]);
  });
});
