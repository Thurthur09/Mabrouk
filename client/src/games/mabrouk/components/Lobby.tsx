import { useState } from 'react';
import type { RoomView } from '@mabrouk/core';
import { api } from '../lib/store';
import { Avatar, RulesButton, SoundButton } from './Widgets';

export function Lobby({ room }: { room: RoomView }) {
  const isHost = room.hostId === room.you;
  const [copied, setCopied] = useState(false);
  const full = room.seats.length >= room.settings.maxPlayers;

  return (
    <div className="lobby">
      <header className="topbar">
        <div className="round">Salon</div>
        <div className="top-actions">
          <RulesButton />
          <SoundButton />
          <button className="icon" onClick={() => api.leave()} aria-label="Quitter">
            🚪
          </button>
        </div>
      </header>

      <div className="card-panel center">
        <div className="muted">Code du salon</div>
        <button
          className="code-big"
          onClick={() => {
            void navigator.clipboard?.writeText(room.code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {room.code}
        </button>
        <div className="muted">{copied ? 'Copié !' : 'Touchez pour copier — partagez-le à vos amis'}</div>
      </div>

      <div className="card-panel">
        <h3>
          Joueurs ({room.seats.length}/{room.settings.maxPlayers})
        </h3>
        <ul className="seats">
          {room.seats.map((s) => (
            <li key={s.id} style={{ ['--c' as string]: s.color }} className={s.id === room.you ? 'me' : ''}>
              <Avatar id={s.avatar} color={s.color} size={36} />
              <span className="nm">{s.name}</span>
              {s.isHost && <span className="tag">hôte</span>}
              {s.isBot && <span className="tag">bot</span>}
              {!s.connected && <span className="tag off">hors ligne</span>}
              {isHost && s.isBot && (
                <button className="icon tiny" onClick={() => api.send({ t: 'removeBot', id: s.id })} aria-label="Retirer le bot">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        {isHost && (
          <button disabled={full} onClick={() => api.send({ t: 'addBot' })}>
            + Ajouter un bot
          </button>
        )}
      </div>

      <div className="card-panel">
        <h3>Réglages {isHost ? '' : '(hôte)'}</h3>
        <label className="field">
          Seuil de fin de partie : <b>{room.settings.targetScore}</b> pts
          <input
            type="range"
            min={10}
            max={150}
            step={5}
            disabled={!isHost}
            value={room.settings.targetScore}
            onChange={(e) => api.send({ t: 'settings', settings: { targetScore: Number(e.target.value) } })}
          />
        </label>
        <label className="field">
          Joueurs maximum : <b>{room.settings.maxPlayers}</b>
          <input
            type="range"
            min={Math.max(2, room.seats.length)}
            max={6}
            disabled={!isHost}
            value={room.settings.maxPlayers}
            onChange={(e) => api.send({ t: 'settings', settings: { maxPlayers: Number(e.target.value) } })}
          />
        </label>
      </div>

      {isHost ? (
        <button className="primary big" disabled={room.seats.length < 2} onClick={() => api.send({ t: 'start' })}>
          {room.seats.length < 2 ? 'Il faut au moins 2 joueurs' : 'Lancer la partie'}
        </button>
      ) : (
        <p className="muted center">En attente du lancement par l'hôte…</p>
      )}
    </div>
  );
}
