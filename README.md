# Mabrouk

Jeu de cartes (Dutch / Tamoul) en application web : moteur de règles autoritaire (TypeScript), serveur
Node/WebSocket, client React (mobile d'abord, dark mode).

Ce dépôt ne contient **que le jeu**, sans plateforme autour — voir la note en bas de page si tu comptes
le réimporter dans un autre projet.

## Lancer

```
npm install
npm test                # 100 tests (moteur, salon, réseau, fuzz)
npm run build           # compile le client
npm start               # serveur + client sur http://localhost:8787
```

Développement : `npm run dev:server` puis `npm run dev:client` (http://localhost:5173).
Le mode « Solo vs bots » tourne entièrement dans le navigateur (même Hub que le serveur).

## Ressources

- Musique : `client/public/audio/zephiramusic-positive-chill-hop.mp3` (boucle, volume par défaut 20 %, réglable dans la vignette 🔊)
- Avatars : `client/public/avatars/1..6.jpg`, découpés depuis `design/avatars-source.jpg` (script `design/crop-avatars.ps1`)
- Emotes (stickers d'astronaute envoyés en partie) : `client/public/emotes/1..12.png`, découpés depuis
  `design/emotes-source.png` (script `design/crop-emotes.ps1`)
- Direction artistique (cartoon espace) : `client/src/games/mabrouk/mabrouk.css`, entièrement scopée sous
  `.mabrouk-scope` (voir plus bas) ; plateau « table de poker » en écran large (≥ 900 px)

## Architecture

### Moteur (indépendant de l'UI)

- `packages/core/src/engine.ts` : GAME ENGINE + machine à états (phases documentées en tête de fichier)
- `cards.ts` (CARD SYSTEM), `players.ts`, `scoring.ts` (`calculateScore`), `effects.ts` (registre d'effets dynamique),
  `config.ts` (règles/valeurs/effets par rang), `views.ts` (vues filtrées par joueur), `ai.ts` (bot Facile),
  `room.ts` / `hub.ts` (salon, exclusion, reconnexion), `protocol.ts`
- `server/` : transport WebSocket, aléatoire cryptographique

### Client (`client/src/`)

```
App.tsx                 <- monte <MabroukApp /> directement, aucun routeur
main.tsx
games/mabrouk/           <- le jeu, module self-contained
  MabroukApp.tsx          \_ point d'entrée : <div className="mabrouk-scope">...
  mabrouk.css             \_ toute la DA du jeu, scopée sous .mabrouk-scope
  components/, lib/
```

`games/mabrouk/` est volontairement autonome : sa CSS est entièrement scopée sous la classe
`.mabrouk-scope` (variables, fond étoilé, tout) pour ne jamais déborder si ce dossier est
réimporté ailleurs. La seule exception assumée est le sélecteur `.card` (et ses variantes
`.card.back`/`.card.face`/`.corner`/`.pip`/`.red-suit`/`.black-suit`) et `.drag-ghost`, qui
restent globaux car la carte glissée est rendue hors de `.mabrouk-scope` via un portail React
(`createPortal` dans `document.body`, voir `components/Cards.tsx`) — nécessaire pour qu'elle
suive le curseur au-dessus de tout le reste.

### Réimporter le jeu dans un autre projet

Ce dépôt a précédemment porté une plateforme (`platform/`) autour du jeu ; elle a été retirée à
la demande pour garder ce dépôt uniquement centré sur le jeu. Pour la reconstruire ailleurs :

1. Copier tout `client/src/games/mabrouk/` tel quel dans le nouveau projet (aucune dépendance
   vers l'extérieur de ce dossier à part `@mabrouk/core`, `react`, `react-dom`).
2. Copier `client/public/avatars/` et `client/public/audio/`.
3. Monter `<MabroukApp />` où l'on veut (route, onglet, etc.) — voir `App.tsx` ici pour l'exemple
   le plus simple : `import { MabroukApp } from './games/mabrouk/MabroukApp'`.
4. Si un identifiant nommé « Connexion », un catalogue ou une page de règles séparée sont
   nécessaires côté plateforme, ils doivent être reconstruits dans ce nouveau projet — rien de
   tout cela ne doit être ajouté dans `games/mabrouk/`, qui ne doit contenir que le jeu.

## Choix d'interprétation (à corriger si besoin)

- Un joueur à tapis vide reste dans son tour si un Mabrouk volontaire est en cours : il doit piocher puis défausser.
- Après 8/9, le joueur regarde la carte jusqu'à un clic « OK, mémorisé » (comme le regard initial).
- Vote d'exclusion : tous les autres humains **connectés** doivent voter ; les bots ne votent pas.
- Une nouvelle manche remélange les 40 cartes ; les cartes d'un joueur exclu sont écartées pour la manche en cours.
- Effet sans cible possible (ex. 7 quand aucun adversaire n'a de carte) : ignoré.
