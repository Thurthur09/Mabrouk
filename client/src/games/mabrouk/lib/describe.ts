import type { GameEvent, PlayerId } from '@mabrouk/core';

export const SUIT_SYMBOL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const isRedSuit = (s: string): boolean => s === 'H' || s === 'D';
export const rankLabel = (r: string): string => (r);
export const rankName = (r: string): string => (r === 'K' ? 'Roi' : r === 'A' ? 'As' : r);

type Face = { rank: string; suit: string; value: number };

/** Texte du journal pour un évènement (ou null s'il n'y a rien à afficher). */
export function describeEvent(e: GameEvent, name: (id: PlayerId) => string, me: PlayerId): string | null {
  const d = e.data as Record<string, unknown>;
  const who = (id: unknown) => (id === me ? 'Vous' : name(String(id)));
  const verb = (id: unknown, you: string, other: string) => (id === me ? you : other);
  const face = (f: unknown) => {
    const c = f as Face | undefined;
    return c ? `${rankName(c.rank)}${SUIT_SYMBOL[c.suit] ?? ''}` : '?';
  };
  switch (e.type) {
    case 'roundStart':
      return `Manche ${d.round} — ${who(d.starter)} ${verb(d.starter, 'commencez', 'commence')}`;
    case 'turn':
      return null;
    case 'takeDiscard':
      return `${who(d.playerId)} ${verb(d.playerId, 'échangez', 'échange')} avec la défausse (${face(d.placed)} défaussé)`;
    case 'draw':
      return `${who(d.playerId)} ${verb(d.playerId, 'piochez', 'pioche')}`;
    case 'swapHeld':
      return `${who(d.playerId)} ${verb(d.playerId, 'posez', 'pose')} la carte piochée (${face(d.discarded)} défaussé)`;
    case 'discardHeld':
      return `${who(d.playerId)} ${verb(d.playerId, 'défaussez', 'défausse')} ${face(d.card)}`;
    case 'effectSkipped':
      return `${who(d.playerId)} ${verb(d.playerId, 'passez', 'passe')} l'effet`;
    case 'peekStart':
      return d.kind === 'own'
        ? `${who(d.playerId)} ${verb(d.playerId, 'regardez', 'regarde')} une de ${verb(d.playerId, 'vos', 'ses')} cartes`
        : `${who(d.playerId)} ${verb(d.playerId, 'regardez', 'regarde')} une carte de ${who(d.targetPlayerId)}`;
    case 'swap':
      return `${who(d.playerId)} ${verb(d.playerId, 'échangez', 'échange')} une carte avec ${who(d.targetPlayerId)}`;
    case 'matchOk':
      return `${who(d.playerId)} ${verb(d.playerId, 'défaussez', 'défausse')} ${face(d.card)} — bonne carte !`;
    case 'matchFail':
      return `Erreur ! ${who(d.playerId)} ${verb(d.playerId, 'défaussez', 'défausse')} ${face(d.card)} : mauvaise carte`;
    case 'penaltyDraw':
      return `${who(d.playerId)} ${verb(d.playerId, 'piochez', 'pioche')} une carte de pénalité`;
    case 'mabrouk':
      return d.auto
        ? `${who(d.playerId)} ${verb(d.playerId, "n'avez", "n'a")} plus de carte : Mabrouk automatique !`
        : `${who(d.playerId)} ${verb(d.playerId, 'annoncez', 'annonce')} MABROUK !`;
    case 'reshuffle':
      return `La pioche est remélangée (${d.count} cartes)`;
    case 'playerRemoved':
      return `${who(d.playerId)} ${verb(d.playerId, 'avez été exclu', 'a été exclu de la partie')}`;
    case 'roundEnd':
      return 'Fin de la manche';
    case 'gameEnd':
      return 'Fin de la partie';
    default:
      return null;
  }
}
