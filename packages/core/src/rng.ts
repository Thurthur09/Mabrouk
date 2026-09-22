// Générateur pseudo-aléatoire sfc32 : état 128 bits, déterministe, entièrement côté serveur.
import type { RngState } from './types';

export function makeRng(seed: number[]): RngState {
  const s: RngState = [seed[0] >>> 0, seed[1] >>> 0, seed[2] >>> 0, seed[3] >>> 0];
  for (let i = 0; i < 15; i++) next(s);
  return s;
}

/** Retourne un flottant dans [0, 1) et fait avancer l'état (mutation). */
export function next(s: RngState): number {
  let a = s[0] | 0;
  let b = s[1] | 0;
  let c = s[2] | 0;
  let d = s[3] | 0;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  s[0] = a >>> 0;
  s[1] = b >>> 0;
  s[2] = c >>> 0;
  s[3] = d >>> 0;
  return (t >>> 0) / 4294967296;
}

export function nextInt(s: RngState, n: number): number {
  return Math.floor(next(s) * n);
}

export function shuffleInPlace<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pick<T>(s: RngState, arr: T[]): T {
  return arr[nextInt(s, arr.length)];
}

export function randomId(s: RngState): string {
  const a = Math.floor(next(s) * 0xffffffff).toString(36);
  const b = Math.floor(next(s) * 0xffffffff).toString(36);
  return 'c' + a + b;
}
