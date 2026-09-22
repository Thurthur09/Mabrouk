import { MabroukApp } from './games/mabrouk/MabroukApp';

/**
 * Application autonome : uniquement le jeu Mabrouk, sans plateforme autour.
 *
 * `games/mabrouk/` est un module self-contained (composants, lib, CSS scopée sous
 * `.mabrouk-scope`, moteur via @mabrouk/core) : pour le réintégrer dans une future plateforme,
 * il suffit de copier ce dossier et de monter <MabroukApp /> où on veut, comme ici.
 */
export function App() {
  return <MabroukApp />;
}
