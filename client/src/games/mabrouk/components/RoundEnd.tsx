import { useState } from 'react';
import type { RoomView } from '@mabrouk/core';
import { api } from '../lib/store';
import { Avatar } from './Widgets';

const medal = (r: number) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : `#${r}`);

export function RoundEnd({ room }: { room: RoomView }) {
  const view = room.game!;
  const res = view.lastRound;
  const ended = view.phase === 'GAME_END';
  const a = view.available;
  const isHost = room.hostId === view.me;
  const nm = (id: string) => view.players.find((p) => p.id === id);
  const [hidden, setHidden] = useState(false);
  if (!res && !ended) return null;

  if (hidden) {
    return (
      <button className="reopen-scores" onClick={() => setHidden(false)}>
        🏆 Voir les scores
      </button>
    );
  }

  const waiting = view.players.filter((p) => p.status === 'active' && !p.ready).map((p) => p.name);
  const reasonText =
    res?.reason === 'mabrouk'
      ? `Mabrouk de ${nm(res.trigger!)?.name}`
      : res?.reason === 'emptyHand'
        ? `${nm(res.trigger!)?.name} n'a plus de carte`
        : 'Pioche épuisée : on compte les points';

  return (
    <div className="overlay">
      <div className="panel">
        <button className="icon tiny panel-close" onClick={() => setHidden(true)} aria-label="Masquer" title="Masquer pour voir la table">
          ✕
        </button>
        <h2>{ended ? '🏆 Partie terminée' : `Fin de la manche ${res?.round}`}</h2>
        {res && <p className="muted">{reasonText}</p>}
        {res?.mabroukOutcome === 'won' && <p className="good">Mabrouk réussi : {nm(res.trigger!)?.name} marque 0 !</p>}
        {res?.mabroukOutcome === 'penalty' && (
          <p className="bad">
            Mabrouk raté : {nm(res.trigger!)?.name} marque {res.raw[res.trigger!]} + {res.penaltyGap} d'écart.
          </p>
        )}

        {res && (
          <table className="scores">
            <thead>
              <tr>
                <th>Manche</th>
                <th>Joueur</th>
                <th>Tapis</th>
                <th>Points</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {res.roundRanking.map((r) => {
                const p = nm(r.playerId);
                return (
                  <tr key={r.playerId} className={r.playerId === view.me ? 'me' : ''}>
                    <td>{medal(r.rank)}</td>
                    <td className="who">
                      {p && <Avatar id={p.avatar} color={p.color} size={24} />} {p?.name}
                    </td>
                    <td>{res.raw[r.playerId]}</td>
                    <td>+{res.roundScores[r.playerId]}</td>
                    <td>
                      <b>{res.totals[r.playerId]}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h3>Classement général (seuil {view.targetScore})</h3>
        <ol className="podium">
          {view.ranking.map((r) => {
            const p = nm(r.playerId)!;
            return (
              <li key={r.playerId} className={view.winners?.includes(r.playerId) ? 'win' : ''}>
                <span>{medal(r.rank)}</span>
                <span className="who">
                  <Avatar id={p.avatar} color={p.color} size={26} /> {p.name}
                </span>
                <b>{p.score}</b>
              </li>
            );
          })}
        </ol>

        {ended ? (
          <div className="row">
            {isHost && (
              <button className="primary" onClick={() => api.send({ t: 'start' })}>
                Rejouer
              </button>
            )}
            <button onClick={() => api.leave()}>Quitter</button>
          </div>
        ) : (
          <div className="row">
            {a.canNextRound ? (
              <button className="primary" onClick={() => api.action({ type: 'nextRound' })}>
                Manche suivante
              </button>
            ) : (
              <span className="muted">En attente de : {waiting.join(', ') || '…'}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
