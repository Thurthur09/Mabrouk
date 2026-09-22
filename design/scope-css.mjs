// Préfixe chaque sélecteur d'un fichier CSS avec `.mabrouk-scope ` pour l'isoler du reste de
// la plateforme. Laisse intacts : @keyframes, @font-face, et tout ce qui commence déjà par
// `.mabrouk-scope`. Récursif dans les blocs @media (dont le sélecteur lui-même n'est pas touché).
// Ignore les caractères ({ } ,) rencontrés à l'intérieur d'un commentaire /* ... */.
import fs from 'node:fs';

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');

/** Découpe `text` sur les virgules de premier niveau, en ignorant celles à l'intérieur d'un commentaire. */
function splitCommaAware(text) {
  const out = [];
  let depth = 0; // 0 = hors commentaire
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '/' && text[i + 1] === '*') depth++;
    else if (text[i] === '*' && text[i + 1] === '/' && depth > 0) {
      depth--;
      i++;
    } else if (text[i] === ',' && depth === 0) {
      out.push(text.slice(last, i));
      last = i + 1;
    }
  }
  out.push(text.slice(last));
  return out;
}

function prefixSelectorList(sel) {
  return splitCommaAware(sel)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // La décision se base sur le texte SANS commentaire (un commentaire qui précède un
      // sélecteur déjà scopé ne doit pas provoquer un double `.mabrouk-scope .mabrouk-scope`).
      const stripped = s.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (stripped.startsWith('.mabrouk-scope')) return s;
      if (stripped === '*') return '.mabrouk-scope, .mabrouk-scope *';
      return `.mabrouk-scope ${s}`;
    })
    .join(',\n');
}

// Découpe le texte en une liste de "morceaux" top-level : soit du texte brut (commentaires,
// espaces), soit un bloc complet `selecteur { ... }` avec accolades équilibrées.
// Les accolades à l'intérieur d'un commentaire /* ... */ sont ignorées.
function splitTopLevel(text) {
  const parts = [];
  let i = 0;
  let last = 0;
  let commentDepth = 0;
  const isCommentStart = (k) => text[k] === '/' && text[k + 1] === '*';
  const isCommentEnd = (k) => text[k] === '*' && text[k + 1] === '/';
  while (i < text.length) {
    if (commentDepth > 0) {
      if (isCommentEnd(i)) {
        commentDepth--;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (isCommentStart(i)) {
      commentDepth++;
      i += 2;
      continue;
    }
    if (text[i] === '{') {
      const selector = text.slice(last, i);
      let depth = 1;
      let j = i + 1;
      let cDepth = 0;
      while (j < text.length && depth > 0) {
        if (cDepth > 0) {
          if (isCommentEnd(j)) {
            cDepth--;
            j += 2;
            continue;
          }
          j++;
          continue;
        }
        if (isCommentStart(j)) {
          cDepth++;
          j += 2;
          continue;
        }
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(i + 1, j - 1);
      parts.push({ type: 'rule', selector, body });
      last = j;
      i = j;
    } else {
      i++;
    }
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

function transform(text) {
  const parts = splitTopLevel(text);
  let out = '';
  for (const p of parts) {
    if (p.type === 'text') {
      out += p.text;
      continue;
    }
    // Un commentaire précédant l'@-rule (ex. un séparateur de section) fait partie du texte du
    // sélecteur : on l'ignore pour DÉTECTER le type de règle, mais on le garde tel quel en sortie.
    const sel = p.selector.replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (sel.startsWith('@keyframes') || sel.startsWith('@font-face')) {
      out += `${p.selector}{${p.body}}`;
    } else if (sel.startsWith('@media') || sel.startsWith('@supports')) {
      out += `${p.selector}{${transform(p.body)}}`;
    } else {
      out += `${p.selector.match(/^\s*/)[0]}${prefixSelectorList(p.selector)} {${p.body}}`;
    }
  }
  return out;
}

fs.writeFileSync(file, transform(src));
console.log('done:', file);
