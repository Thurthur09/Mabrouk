import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, GameView, PlayerGameView, RoomView } from '@mabrouk/core';
import { api, onEmotes, onGameEvents, useClient } from '../lib/store';
import { play } from '../lib/sound';
import { Card, Mat } from './Cards';
import { RoundEnd } from './RoundEnd';
import { Avatar, EmoteButton, EmoteImg, RulesButton, SoundButton } from './Widgets';

const medal = (r: number) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`);

/** Places des adversaires autour de la table (version web), en % de la scène : [x, y] du centre. */
const SEATS: Record<number, [number, number][]> = {
  1: [[50, 7]],
  2: [
    [27, 19],
    [73, 19],
  ],
  3: [
    [12, 47],
    [50, 6],
    [88, 47],
  ],
  4: [
    [11, 54],
    [34, 17],
    [66, 17],
    [89, 54],
  ],
  5: [
    [9, 58],
    [22, 25],
    [50, 5],
    [78, 25],
    [91, 58],
  ],
};

function hintFor(view: GameView, name: (id: string) => string, takeMode: boolean, selOwn: string | null): string {
  const a = view.available;
  const cur = view.currentPlayer;
  const mine = cur === view.me;
  switch (view.phase) {
    case 'INITIAL_LOOK': {
      if (a.canLookInitial) return `Touchez ${view.initialLookNeeded - view.initialLookCount} de vos cartes pour les regarder`;
      if (a.canReady) return 'Mémorisez vos cartes, puis appuyez sur « Prêt »';
      return 'En attente des autres joueurs…';
    }
    case 'TURN_START':
      if (mine) return takeMode ? 'Touchez la carte de votre tapis à échanger avec la défausse' : 'À vous ! Mabrouk, touchez la défausse pour échanger, ou la pioche pour piocher';
      break;
    case 'AWAIT_DRAW':
      if (mine) return 'Touchez la pioche (obligatoire)';
      break;
    case 'HOLDING':
      if (mine) return 'Touchez une carte de votre tapis pour l\'échanger, ou la défausse pour vous en défausser';
      break;
    case 'EFFECT':
      if (mine) {
        if (a.canUseEffect === 'peekOwn') return 'Effet : touchez une de vos cartes pour la regarder (ou passez)';
        if (a.canUseEffect === 'peekOther') return 'Effet : touchez une carte adverse pour la regarder (ou passez)';
        if (a.canUseEffect === 'swapBlind') return selOwn ? 'Effet : touchez maintenant la carte adverse à échanger' : 'Effet : touchez une de vos cartes, puis une carte adverse (ou passez)';
        return 'Effet à résoudre';
      }
      break;
    case 'PEEK':
      if (view.peek?.playerId === view.me) return 'Mémorisez la carte, puis confirmez';
      break;
    default:
      break;
  }
  if (cur) return `Tour de ${name(cur)}`;
  return '';
}

export function Game({ room }: { room: RoomView }) {
  const view = room.game!;
  const { log } = useClient();
  const players = view.players;
  const me = players.find((p) => p.id === view.me)!;
  const opponents = players.filter((p) => p.id !== view.me);
  const a = view.available;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
  const seatOf = (id: string) => room.seats.find((s) => s.id === id);

  const [takeMode, setTakeMode] = useState(false);
  const [quick, setQuick] = useState(false);
  const [selOwn, setSelOwn] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [flash, setFlash] = useState<{ id: number; text: string } | null>(null);
  const flashId = useRef(0);
  const [bubbles, setBubbles] = useState<Record<string, { id: number; emote: string }>>({});
  const bubbleId = useRef(0);
  const [swapFx, setSwapFx] = useState<Record<string, number>>({});
  const swapFxId = useRef(0);

  const flashSwap = (ids: string[]) => {
    const id = ++swapFxId.current;
    setSwapFx((s) => {
      const next = { ...s };
      for (const cid of ids) next[cid] = id;
      return next;
    });
    setTimeout(() => {
      setSwapFx((s) => {
        const next = { ...s };
        for (const cid of ids) if (next[cid] === id) delete next[cid];
        return next;
      });
    }, 700);
  };
  const swappedIds = useMemo(() => new Set(Object.keys(swapFx)), [swapFx]);

  useEffect(() => {
    return onEmotes((playerId, emote) => {
      const id = ++bubbleId.current;
      setBubbles((b) => ({ ...b, [playerId]: { id, emote } }));
      setTimeout(() => {
        setBubbles((b) => {
          if (b[playerId]?.id !== id) return b;
          const { [playerId]: _drop, ...rest } = b;
          return rest;
        });
      }, 1900);
    });
  }, []);

  useEffect(() => {
    setTakeMode(false);
    setSelOwn(null);
  }, [view.phase, view.currentPlayer, view.round]);

  // Sons et bandeau d'annonce pilotés par les évènements du serveur.
  useEffect(() => {
    return onGameEvents((events: GameEvent[]) => {
      for (const e of events) {
        const mineEvt = (e.data as { playerId?: string }).playerId === view.me;
        switch (e.type) {
          case 'draw':
          case 'drawPrivate':
            if (e.type === 'draw') play('draw');
            break;
          case 'discardHeld':
            play('discard');
            break;
          case 'takeDiscard':
            flashSwap([(e.data as { takenCardId: string }).takenCardId]);
            play('discard');
            break;
          case 'swapHeld':
            flashSwap([(e.data as { placedCardId: string }).placedCardId]);
            play('discard');
            break;
          case 'swap':
            flashSwap([(e.data as { ownCardId: string; targetCardId: string }).ownCardId, (e.data as { ownCardId: string; targetCardId: string }).targetCardId]);
            play('swap');
            break;
          case 'peek':
            play('peek');
            break;
          case 'matchOk':
            play('ok');
            break;
          case 'matchFail':
            play('error');
            break;
          case 'turn':
            if ((e.data as { playerId?: string }).playerId === view.me) play('turn');
            break;
          case 'mabrouk':
            play('mabrouk');
            setFlash({ id: ++flashId.current, text: mineEvt ? 'Mabrouk !' : `${name((e.data as { playerId: string }).playerId)} : Mabrouk !` });
            break;
          case 'gameEnd':
            play((e.data as { winners: string[] }).winners.includes(view.me) ? 'win' : 'lose');
            break;
          default:
            break;
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.me, players.length]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const myTurn = view.currentPlayer === view.me;
  const effect = a.canUseEffect;

  const ownSelectable: Set<string> | null = useMemo(() => {
    const all = new Set(me.hand.map((c) => c.id));
    if (quick && a.canMatchDiscard) return all;
    if (a.canLookInitial) return new Set(me.hand.filter((c) => c.face === null).map((c) => c.id));
    if ((takeMode && a.canTakeDiscard) || a.canSwapHeld) return all;
    if (effect === 'peekOwn' || effect === 'swapBlind') return all;
    return null;
  }, [me.hand, quick, a, takeMode, effect]);

  const oppSelectable = effect === 'peekOther' || (effect === 'swapBlind' && !!selOwn);

  const onTapOwn = (id: string) => {
    if (quick && a.canMatchDiscard) {
      api.action({ type: 'matchDiscard', cardId: id });
      setQuick(false);
      return;
    }
    if (a.canLookInitial) return api.action({ type: 'lookInitial', cardId: id });
    if (takeMode && a.canTakeDiscard) {
      setTakeMode(false);
      return api.action({ type: 'takeDiscard', cardId: id });
    }
    if (a.canSwapHeld) return api.action({ type: 'swapHeld', cardId: id });
    if (effect === 'peekOwn') return api.action({ type: 'useEffect', params: { cardId: id } });
    if (effect === 'swapBlind') return setSelOwn(id === selOwn ? null : id);
  };

  const onTapOpp = (pid: string, cardId: string) => {
    if (effect === 'peekOther') return api.action({ type: 'useEffect', params: { targetPlayerId: pid, targetCardId: cardId } });
    if (effect === 'swapBlind' && selOwn) {
      const own = selOwn;
      setSelOwn(null);
      return api.action({ type: 'useEffect', params: { ownCardId: own, targetPlayerId: pid, targetCardId: cardId } });
    }
  };

  const heldByMe = view.held?.playerId === view.me;
  const discardClickable = a.canDiscardHeld || (a.canTakeDiscard && !a.canSwapHeld) || a.canMatchDiscard;
  const cols = opponents.length <= 1 ? 1 : opponents.length === 2 ? 2 : 3;
  const votes = room.kickVotes;
  const humansOthers = room.seats.filter((s) => !s.isBot && s.connected);

  return (
    <div className="game">
      <header className="topbar">
        <div className="round">
          Manche {view.round} <span className="muted">· seuil {view.targetScore}</span>
        </div>
        <div className="top-actions">
          <button className="icon" onClick={() => setShowLog((v) => !v)} aria-label="Journal" title="Journal de la partie">
            📜
          </button>
          <RulesButton />
          <SoundButton />
          <button
            className="icon"
            aria-label="Quitter"
            onClick={() => {
              if (confirm('Quitter la partie ? Vous pourrez revenir tant que le salon existe.')) api.leave();
            }}
          >
            🚪
          </button>
        </div>
      </header>

      <div className="ranking" aria-label="Classement général">
        {view.ranking.map((r) => {
          const p = players.find((x) => x.id === r.playerId)!;
          return (
            <div
              key={r.playerId}
              className={`chip ${r.playerId === view.me ? 'me' : ''} ${view.currentPlayer === r.playerId ? 'turn' : ''}`}
              style={{ ['--c' as string]: p.color }}
            >
              <span className="medal">{medal(r.rank)}</span>
              <Avatar id={p.avatar} color={p.color} size={24} />
              <span className="nm">{p.name}</span>
              <b>{p.score}</b>
            </div>
          );
        })}
      </div>

      {Object.entries(votes).map(([target, voters]) => {
        const tSeat = seatOf(target);
        if (!tSeat) return null;
        const needed = humansOthers.filter((s) => s.id !== target).length;
        const iVoted = voters.includes(view.me);
        const isMe = target === view.me;
        return (
          <div className="banner kick" key={target}>
            <span>
              {isMe ? 'Un vote pour vous exclure est en cours' : `Vote d'exclusion contre ${tSeat.name}`} ({voters.length}/{needed})
            </span>
            {!isMe &&
              (iVoted ? (
                <button onClick={() => api.send({ t: 'cancelKick', target })}>Retirer mon vote</button>
              ) : (
                <button className="danger" onClick={() => api.send({ t: 'voteKick', target })}>
                  Voter
                </button>
              ))}
          </div>
        );
      })}

      <div className="stage">
      <div className="rim" aria-hidden="true" />
      <section className={`opponents cols-${cols}`}>
        {opponents.map((p, i) => (
          <OpponentMat
            key={p.id}
            seat={(SEATS[Math.min(5, opponents.length)] ?? SEATS[5])[i] ?? [50, 15]}
            p={p}
            view={view}
            bubble={bubbles[p.id]?.emote}
            connected={seatOf(p.id)?.connected ?? true}
            selectable={oppSelectable && p.status === 'active'}
            onTap={(cid) => onTapOpp(p.id, cid)}
            justChanged={swappedIds}
            canKick={!!seatOf(p.id) && !seatOf(p.id)!.isBot && p.status === 'active' && !votes[p.id]}
            onKick={() => {
              if (confirm(`Lancer un vote pour exclure ${p.name} ?`)) api.send({ t: 'voteKick', target: p.id });
            }}
          />
        ))}
      </section>

      <section className="table">
        <div className="piles">
          <div className="pile">
            <div
              className={`stack ${a.canDraw ? 'clickable' : ''} ${a.canDraw && view.phase === 'AWAIT_DRAW' ? 'urgent' : ''}`}
              onClick={() => a.canDraw && api.action({ type: 'draw' })}
            >
              {view.deckCount > 3 && <Card face={null} className="shadow shadow-2" />}
              {view.deckCount > 1 && <Card face={null} className="shadow shadow-1" />}
              <Card face={null} />
              <span className="count">{view.deckCount}</span>
            </div>
            <label>Pioche</label>
          </div>

          <div className="held-zone">
            {view.held ? (
              <div className="held" key={view.held.cardId}>
                <Card face={heldByMe ? view.held.face : null} className={heldByMe ? 'lift' : 'lift dim'} />
                <label>{heldByMe ? 'Votre carte' : `${name(view.held.playerId)} tient une carte`}</label>
              </div>
            ) : (
              <div className="held-empty" />
            )}
          </div>

          <div className="pile">
            <div
              className={`stack drop ${discardClickable ? 'clickable' : ''}`}
              data-drop="discard"
              onClick={() => {
                if (a.canDiscardHeld) return api.action({ type: 'discardHeld' });
                if (a.canTakeDiscard && !a.canSwapHeld) return setTakeMode((v) => !v);
                if (a.canMatchDiscard) return setQuick((v) => !v);
              }}
            >
              {view.discardCount > 3 && <Card face={null} className="shadow shadow-2" />}
              {view.discardCount > 1 && <Card face={null} className="shadow shadow-1" />}
              {view.discardTop ? <Card face={view.discardTop} className="drop-in" key={view.discardTop.id} /> : <div className="card empty" />}
              <span className="count">{view.discardCount}</span>
            </div>
            <label>Défausse</label>
          </div>
        </div>

        <div className={`hint ${myTurn ? 'mine' : ''}`}>{hintFor(view, name, takeMode, selOwn)}</div>
        {view.finalLap && (
          <div className="banner lap">
            {view.finalLap.reason === 'mabrouk' ? `Mabrouk de ${name(view.finalLap.trigger)}` : `${name(view.finalLap.trigger)} n'a plus de carte`} — dernier tour !
          </div>
        )}
        {log.length > 0 && !showLog && <div className="ticker">{log[log.length - 1].text}</div>}
      </section>

      <section className={`me-zone ${myTurn ? 'active' : ''}`} style={{ ['--c' as string]: me.color }}>
        <div className={`nameplate ${myTurn ? 'active' : ''}`} style={{ ['--c' as string]: me.color }}>
          {bubbles[me.id] && (
            <span className="emote-bubble" key={bubbles[me.id].id}>
              <EmoteImg id={bubbles[me.id].emote} />
            </span>
          )}
          <Avatar id={me.avatar} color={me.color} size={34} />
          <b>{me.name}</b>
          <span className="muted">
            {me.cardCount} carte{me.cardCount > 1 ? 's' : ''} · {me.score} pts
          </span>
          {myTurn && <span className="turn-badge">à vous</span>}
        </div>
        <div className="mat-wrap">
          <Mat
            cards={me.hand}
            color={me.color}
            draggable
            selectable={ownSelectable}
            selected={selOwn}
            onTap={onTapOwn}
            onMove={(id, x, y) => api.action({ type: 'moveCard', cardId: id, x, y })}
            onDropDiscard={(id) => api.action({ type: 'matchDiscard', cardId: id })}
            justChanged={swappedIds}
          />
          <div className="emote-fab-wrap">
            <EmoteButton onPick={(id) => api.emote(id)} />
          </div>
        </div>
      </section>
      </div>

      <footer className="actions">
        {a.canReady && (
          <button className="primary" onClick={() => api.action({ type: 'ready' })}>
            ✔ Prêt
          </button>
        )}
        {a.canCallMabrouk && (
          <button className="gold" onClick={() => api.action({ type: 'callMabrouk' })}>
            📣 Mabrouk
          </button>
        )}
        {a.canSkipEffect && <button onClick={() => api.action({ type: 'skipEffect' })}>Passer l'effet</button>}
        {a.canConfirmPeek && (
          <button className="primary" onClick={() => api.action({ type: 'confirmPeek' })}>
            OK, mémorisé
          </button>
        )}
      </footer>

      {showLog && (
        <div className="log-panel" onClick={() => setShowLog(false)}>
          {log
            .slice()
            .reverse()
            .map((l) => (
              <div key={l.id} className={`log ${l.kind}`}>
                {l.text}
              </div>
            ))}
          {!log.length && <div className="muted">Rien pour le moment.</div>}
        </div>
      )}

      {flash && (
        <div className="flash-banner" key={flash.id}>
          {flash.text}
        </div>
      )}

      {(view.phase === 'ROUND_END' || view.phase === 'GAME_END') && <RoundEnd room={room} />}
    </div>
  );
}

function OpponentMat({
  p,
  seat,
  view,
  bubble,
  connected,
  selectable,
  onTap,
  canKick,
  onKick,
  justChanged,
}: {
  p: PlayerGameView;
  seat: [number, number];
  view: GameView;
  bubble?: string;
  connected: boolean;
  selectable: boolean;
  onTap: (cardId: string) => void;
  canKick: boolean;
  onKick: () => void;
  justChanged?: Set<string>;
}) {
  const active = view.currentPlayer === p.id;
  const removed = p.status === 'removed';
  // Trop près du haut de l'écran (table en vue web) pour laisser la place à une bulle au-dessus : on l'affiche en dessous.
  const bubbleBelow = seat[1] < 15;
  return (
    <div
      className={`opp ${active ? 'active' : ''} ${removed ? 'removed' : ''}`}
      style={{ ['--c' as string]: p.color, ['--x' as string]: `${seat[0]}%`, ['--y' as string]: `${seat[1]}%` }}
    >
      <div className="opp-head">
        {bubble && (
          <span className={`emote-bubble ${bubbleBelow ? 'below' : ''}`}>
            <EmoteImg id={bubble} />
          </span>
        )}
        <Avatar id={p.avatar} color={p.color} size={26} />
        <span className="nm">{p.name}</span>
        {active && <span className="turn-badge">joue</span>}
        {!connected && !p.isBot && <span className="off">hors ligne</span>}
        {view.finalLap?.trigger === p.id && <span className="mb">Mabrouk</span>}
        {view.phase === 'INITIAL_LOOK' && p.ready && <span className="rdy">prêt</span>}
        {canKick && (
          <button className="icon tiny" onClick={onKick} title="Voter pour exclure" aria-label={`Exclure ${p.name}`}>
            ⛔
          </button>
        )}
      </div>
      {removed ? (
        <div className="excluded">exclu</div>
      ) : (
        <Mat cards={p.hand} color={p.color} small selectable={selectable ? 'all' : null} onTap={onTap} justChanged={justChanged} />
      )}
      <div className="opp-foot muted">
        {p.cardCount} carte{p.cardCount > 1 ? 's' : ''} · {p.score} pts
      </div>
    </div>
  );
}
