import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { music, useMusic } from '../lib/music';
import { AVATARS, COLORS } from '../lib/profile';
import { isMuted, play, setMuted, subscribeMuted } from '../lib/sound';
import { RulesContent } from './RulesContent';

/** Avatar : image (« img:N ») ou, à défaut, un emoji. */
export function Avatar({ id, color, size = 32, className = '' }: { id: string; color?: string; size?: number; className?: string }) {
  const style = { width: size, height: size, ['--ring' as string]: color ?? '#7c9cff' };
  if (id.startsWith('img:')) {
    return (
      <img
        className={`avatar ${className}`}
        style={style}
        src={`${import.meta.env.BASE_URL}avatars/${id.slice(4)}.jpg`}
        alt=""
        draggable={false}
      />
    );
  }
  return (
    <span className={`avatar emoji ${className}`} style={{ ...style, fontSize: size * 0.62 }}>
      {id}
    </span>
  );
}

/** Petite vignette (popover) ancrée à un bouton icône. */
function Popover({
  icon,
  label,
  children,
  wide,
  buttonClassName,
  popoverClassName,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  buttonClassName?: string;
  popoverClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="pop-wrap" ref={ref}>
      <button className={`icon ${open ? 'on' : ''} ${buttonClassName ?? ''}`} aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>
        {icon}
      </button>
      {open && <div className={`popover ${wide ? 'wide' : ''} ${popoverClassName ?? ''}`}>{children}</div>}
    </div>
  );
}

/** Vignette audio : musique (volume, coupure) et effets sonores. */
export function SoundButton() {
  const sfxMuted = useSyncExternalStore(subscribeMuted, isMuted);
  const m = useMusic();
  return (
    <Popover icon={m.enabled || !sfxMuted ? '🔊' : '🔇'} label="Son et musique">
      <h4>Son</h4>
      <label className="pop-row">
        <span>🎵 Musique</span>
        <input type="checkbox" checked={m.enabled} onChange={(e) => music.setEnabled(e.target.checked)} />
      </label>
      <label className="pop-col">
        <span>Volume : {Math.round(m.volume * 100)} %</span>
        <input type="range" min={0} max={100} value={Math.round(m.volume * 100)} disabled={!m.enabled} onChange={(e) => music.setVolume(Number(e.target.value) / 100)} />
      </label>
      <label className="pop-row">
        <span>✨ Effets sonores</span>
        <input
          type="checkbox"
          checked={!sfxMuted}
          onChange={(e) => {
            setMuted(!e.target.checked);
            if (e.target.checked) play('click');
          }}
        />
      </label>
    </Popover>
  );
}

/** Vignette des règles du jeu. */
export function RulesButton() {
  return (
    <Popover icon="❓" label="Règles du jeu" wide>
      <h4>Règles de Mabrouk</h4>
      <RulesContent />
    </Popover>
  );
}

/** Emotes d'astronaute (stickers) envoyés aux autres joueurs pendant la partie.
 * Images découpées depuis design/emotes-source.png (script design/crop-emotes.ps1). */
export const EMOTE_IDS = Array.from({ length: 12 }, (_, i) => String(i + 1));

export function EmoteImg({ id, className = '' }: { id: string; className?: string }) {
  return <img className={`emote-img ${className}`} src={`${import.meta.env.BASE_URL}emotes/${id}.png`} alt="" draggable={false} />;
}

export function EmoteButton({ onPick }: { onPick: (id: string) => void }) {
  return (
    <Popover icon={<EmoteImg id="1" className="trigger" />} label="Emotes" buttonClassName="fab-trigger" popoverClassName="emotes-pop">
      <h4>Emotes</h4>
      <div className="emote-grid">
        {EMOTE_IDS.map((id) => (
          <button key={id} className="emote-pick" onClick={() => onPick(id)} aria-label={`Envoyer l'emote ${id}`}>
            <EmoteImg id={id} />
          </button>
        ))}
      </div>
    </Popover>
  );
}

export function AvatarPicker({
  avatar,
  color,
  onChange,
}: {
  avatar: string;
  color: string;
  onChange: (p: { avatar?: string; color?: string }) => void;
}) {
  return (
    <div className="picker">
      <div className="avatars">
        {AVATARS.map((a) => (
          <button key={a} className={`av-btn ${a === avatar ? 'sel' : ''}`} onClick={() => onChange({ avatar: a })} aria-label={`Avatar ${a}`}>
            <Avatar id={a} color={a === avatar ? color : '#3a3370'} size={56} />
          </button>
        ))}
      </div>
      <div className="colors">
        {COLORS.map((c) => (
          <button
            key={c}
            className={`col-btn ${c === color ? 'sel' : ''}`}
            style={{ background: c }}
            onClick={() => onChange({ color: c })}
            aria-label={`Couleur ${c}`}
          />
        ))}
      </div>
    </div>
  );
}
