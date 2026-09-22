import { useEffect } from 'react';
import { Game } from './components/Game';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { api, savedSession, useClient } from './lib/store';
import { music } from './lib/music';
import './mabrouk.css';

/**
 * Point d'entrée du jeu Mabrouk, monté par la plateforme sur la route /games/mabrouk.
 * Toute la CSS du jeu est scopée sous `.mabrouk-scope` : elle ne déborde jamais sur les
 * pages de la plateforme (accueil, catalogue, règles).
 */
export function MabroukApp() {
  const { room, toasts, link, mode } = useClient();

  // Reconnexion automatique à la dernière partie en ligne (place conservée côté serveur).
  useEffect(() => {
    if (savedSession()) api.resume();
    music.arm(); // la musique du jeu ne démarre qu'en entrant dans Mabrouk, pas sur la plateforme
  }, []);

  return (
    <div className="mabrouk-scope">
      {link === 'offline' && mode === 'remote' && room && <div className="offline-bar">Connexion perdue — reconnexion…</div>}
      {!room ? <Home /> : room.status === 'lobby' ? <Lobby room={room} /> : <Game room={room} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
