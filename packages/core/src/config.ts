import type { GameConfig } from './types';

/** Règles exactes de la spécification. */
export const DEFAULT_CONFIG: GameConfig = {
  minPlayers: 2,
  maxPlayers: 6,
  targetScore: 50,
  handSize: 4,
  initialLookCount: 2,
  gridColumns: 2,
  penaltyRevealMs: 5000,
  suits: ['S', 'H', 'D', 'C'],
  // As = 1, 2..9 = leur nombre, Roi = 0. Pas de joker, pas de 10/Valet/Dame.
  ranks: [
    { rank: 'A', value: 1 },
    { rank: '2', value: 2 },
    { rank: '3', value: 3 },
    { rank: '4', value: 4 },
    { rank: '5', value: 5 },
    { rank: '6', value: 6 },
    { rank: '7', value: 7 },
    { rank: '8', value: 8 },
    { rank: '9', value: 9 },
    { rank: 'K', value: 0 },
  ],
  // 7 : échange à l'aveugle avec un autre joueur ; 8 : regarder une de ses cartes ;
  // 9 : regarder une carte adverse. Modifiable ici sans toucher au moteur.
  effects: { '7': 'swapBlind', '8': 'peekOwn', '9': 'peekOther' },
};

export function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides, effects: { ...(overrides.effects ?? DEFAULT_CONFIG.effects) } };
}
