// Musique d'ambiance en boucle (fichier : client/public/audio/). Volume par défaut : 20 %.
import { useSyncExternalStore } from 'react';

const SRC = `${import.meta.env.BASE_URL}audio/zephiramusic-positive-chill-hop.mp3`;
const KEY = 'mabrouk.music';

interface MusicState {
  enabled: boolean;
  volume: number;
}

function load(): MusicState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<MusicState>;
      return {
        enabled: p.enabled !== false,
        volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 0.2,
      };
    }
  } catch {
    /* ignore */
  }
  return { enabled: true, volume: 0.2 };
}

let state: MusicState = load();
let audio: HTMLAudioElement | null = null;
let armed = false;
const listeners = new Set<() => void>();

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = state.volume;
  }
  return audio;
}

function set(patch: Partial<MusicState>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

function tryPlay(): void {
  if (!state.enabled) return;
  el()
    .play()
    .catch(() => {
      /* bloqué par le navigateur : on réessaiera au prochain geste */
    });
}

export const music = {
  /** À appeler une fois : la lecture démarre au premier geste de l'utilisateur (règle des navigateurs). */
  arm(): void {
    if (armed) return;
    armed = true;
    const start = () => {
      tryPlay();
      if (!audio || audio.paused === false || !state.enabled) {
        window.removeEventListener('pointerdown', start);
        window.removeEventListener('keydown', start);
      }
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  },
  setEnabled(enabled: boolean): void {
    set({ enabled });
    if (enabled) tryPlay();
    else audio?.pause();
  },
  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, volume));
    set({ volume: v });
    el().volume = v;
  },
};

export function useMusic(): MusicState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
