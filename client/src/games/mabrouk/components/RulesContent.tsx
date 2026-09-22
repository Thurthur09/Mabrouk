/**
 * Texte des règles de Mabrouk, partagé entre la vignette « ❓ » dans le jeu (Widgets.tsx)
 * et le résumé exposé à la plateforme via RulesSummary.tsx (games/mabrouk/manifest.ts). Source unique :
 * ne jamais dupliquer ce texte ailleurs.
 */
export function RulesContent() {
  return (
    <ol className="rules">
      <li>
        <b>But :</b> finir avec le moins de points. Chaque carte restante sur ton tapis vaut sa valeur <b>+ 1 point</b> : As = 1, 2 à 9 = leur nombre, Roi =
        0.
      </li>
      <li>
        <b>Début :</b> 4 cartes face cachée par joueur. Regarde 2 de tes cartes, mémorise-les, puis clique « Prêt ». Ensuite tu ne peux plus les revoir.
      </li>
      <li>
        <b>Ton tour</b> (sens horaire) : <i>1.</i> tu peux échanger une carte de ton tapis avec la carte de la défausse (facultatif) ; <i>2.</i> tu pioches
        (obligatoire) ; <i>3.</i> tu échanges la carte piochée avec une des tiennes, ou tu la défausses.
      </li>
      <li>
        <b>Effets</b> (carte piochée puis défaussée directement, facultatif) : <b>7</b> échange une de tes cartes avec celle d'un autre joueur, à l'aveugle ;{' '}
        <b>8</b> regarde une de tes cartes ; <b>9</b> regarde une carte adverse.
      </li>
      <li>
        <b>Défausse rapide :</b> à tout moment, même hors de ton tour, glisse une de tes cartes sur la défausse si tu penses qu'elle a la même valeur que la
        carte du dessus. Bonne carte : elle part. Mauvaise : elle reste, s'affiche en rouge 5 s et tu pioches une carte de pénalité.
      </li>
      <li>
        <b>Mabrouk :</b> au début de ton tour, avant toute action, annonce « Mabrouk » : tu passes ton tour et chacun joue un dernier tour. Si tu as
        strictement le meilleur score, tu marques 0 ; sinon ton score + l'écart avec le meilleur. Vider son tapis déclenche Mabrouk automatiquement
        (0 point).
      </li>
      <li>
        <b>Fin de partie :</b> les points s'additionnent manche après manche. Dès qu'un joueur atteint le seuil, la partie s'arrête : le score le plus bas
        gagne.
      </li>
    </ol>
  );
}
