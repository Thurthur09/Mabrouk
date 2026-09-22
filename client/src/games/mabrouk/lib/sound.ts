// Sons synthétisés (WebAudio) : aucun fichier audio, coupables d'un bouton.
type SoundName = 'draw' | 'discard' | 'swap' | 'ok' | 'error' | 'turn' | 'mabrouk' | 'win' | 'lose' | 'peek' | 'click';

const KEY = 'mabrouk.muted';
let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem(KEY) === '1';
} catch {
  /* ignore */
}
const listeners = new Set<() => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function subscribeMuted(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.12, delay = 0, endFreq?: number): void {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function play(name: SoundName): void {
  if (muted) return;
  try {
    switch (name) {
      case 'click':
        tone(520, 0.05, 'triangle', 0.06);
        break;
      case 'draw':
        tone(260, 0.09, 'triangle', 0.12, 0, 520);
        break;
      case 'discard':
        tone(180, 0.12, 'square', 0.06, 0, 90);
        break;
      case 'swap':
        tone(300, 0.18, 'sine', 0.1, 0, 700);
        tone(700, 0.18, 'sine', 0.06, 0.1, 300);
        break;
      case 'ok':
        tone(660, 0.1, 'triangle', 0.1);
        tone(880, 0.14, 'triangle', 0.1, 0.09);
        break;
      case 'error':
        tone(140, 0.32, 'sawtooth', 0.09, 0, 90);
        break;
      case 'turn':
        tone(740, 0.1, 'sine', 0.08);
        tone(988, 0.16, 'sine', 0.08, 0.1);
        break;
      case 'peek':
        tone(440, 0.14, 'sine', 0.07, 0, 660);
        break;
      case 'mabrouk':
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.11, i * 0.1));
        break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, i * 0.12));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', 0.1, i * 0.16));
        break;
    }
  } catch {
    /* le son ne doit jamais casser le jeu */
  }
}
