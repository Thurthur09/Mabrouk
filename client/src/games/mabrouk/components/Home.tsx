import { useEffect, useState } from 'react';
import type { Profile } from '@mabrouk/core';
import { loadProfile, saveProfile } from '../lib/profile';
import { api, savedSession, useClient } from '../lib/store';
import { play } from '../lib/sound';
import { Avatar, AvatarPicker, RulesButton, SoundButton } from './Widgets';

export function Home() {
  const { link, kicked } = useClient();
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [bots, setBots] = useState(2);
  const [target, setTarget] = useState(50);
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'solo' | 'online'>('solo');
  const resumable = savedSession();

  useEffect(() => saveProfile(profile), [profile]);

  const named: Profile = { ...profile, name: profile.name.trim() || 'Joueur' };
  const busy = link === 'connecting';

  return (
    <div className="home">
      <div className="home-top">
        <RulesButton />
        <SoundButton />
      </div>
      <h1>MABROUK</h1>
      <p className="tagline">Tu connais tes cartes ? Ou tu crois les connaître ?</p>

      {kicked && (
        <div className="banner kick">
          Vous avez été exclu de la partie par vote.
          <button onClick={() => api.acknowledgeKick()}>OK</button>
        </div>
      )}

      <div className="card-panel">
        <h3>Votre profil</h3>
        <input
          className="text"
          value={profile.name}
          maxLength={16}
          placeholder="Votre pseudo"
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
        />
        <AvatarPicker avatar={profile.avatar} color={profile.color} onChange={(p) => setProfile({ ...profile, ...p })} />
        <div className="preview" style={{ ['--c' as string]: profile.color }}>
          <Avatar id={profile.avatar} color={profile.color} size={52} />
          <b>{named.name}</b>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'solo' ? 'on' : ''} onClick={() => setTab('solo')}>
          Solo vs bots
        </button>
        <button className={tab === 'online' ? 'on' : ''} onClick={() => setTab('online')}>
          Multijoueur
        </button>
      </div>

      {tab === 'solo' ? (
        <div className="card-panel">
          <label className="field">
            Bots (niveau Facile) : <b>{bots}</b>
            <input type="range" min={1} max={5} value={bots} onChange={(e) => setBots(Number(e.target.value))} />
          </label>
          <label className="field">
            Seuil de fin de partie : <b>{target}</b> pts
            <input type="range" min={10} max={150} step={5} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
          </label>
          <button
            className="primary big"
            onClick={() => {
              play('click');
              api.startSolo(named, bots, target);
            }}
          >
            Jouer
          </button>
        </div>
      ) : (
        <div className="card-panel">
          <button
            className="primary big"
            disabled={busy}
            onClick={() => {
              play('click');
              api.createOnline(named, { targetScore: target });
            }}
          >
            Créer un salon
          </button>
          <div className="or">ou rejoindre</div>
          <div className="row">
            <input
              className="text code"
              value={code}
              maxLength={5}
              placeholder="CODE"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button disabled={busy || code.length < 4} onClick={() => api.joinOnline(code, named)}>
              Rejoindre
            </button>
          </div>
          {resumable && (
            <button className="ghost" onClick={() => api.resume()}>
              ↻ Reprendre la partie {resumable.code}
            </button>
          )}
          {link === 'offline' && <p className="bad">Serveur injoignable. Vérifiez qu'il est lancé (npm run dev:server).</p>}
        </div>
      )}
    </div>
  );
}
