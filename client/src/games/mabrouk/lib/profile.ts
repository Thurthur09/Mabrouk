import type { Profile } from '@mabrouk/core';

/** Avatars image : fichiers client/public/avatars/1..6.jpg, référencés « img:N ». */
export const AVATARS = ['img:1', 'img:2', 'img:3', 'img:4', 'img:5', 'img:6'];
export const COLORS = ['#7c9cff', '#f59e0b', '#22c55e', '#ec4899', '#38bdf8', '#a78bfa', '#ef4444', '#14b8a6', '#eab308', '#f97316'];

const KEY = 'mabrouk.profile';

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      if (p.name !== undefined && p.avatar && AVATARS.includes(p.avatar) && p.color) {
        return { name: p.name, avatar: p.avatar, color: p.color };
      }
    }
  } catch {
    /* stockage indisponible */
  }
  return {
    name: '',
    avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)],
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
