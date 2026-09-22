import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardView, FaceView } from '@mabrouk/core';
import { SUIT_SYMBOL, isRedSuit, rankLabel, rankName } from '../lib/describe';

interface FaceProps {
  face: FaceView | null;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  /** Repère l'élément par l'id de la carte, pour retrouver sa position à l'écran (animations de vol). */
  cardId?: string;
}

/** Carte seule (face visible ou dos). Dimensionnée par son conteneur. */
export function Card({ face, className = '', style, title, cardId }: FaceProps) {
  if (!face) {
    return <div className={`card back ${className}`} style={style} title={title ?? 'Carte cachée'} data-card-id={cardId} />;
  }
  const red = isRedSuit(face.suit);
  return (
    <div
      className={`card face ${red ? 'red-suit' : 'black-suit'} ${className}`}
      style={style}
      key={`${face.rank}${face.suit}`}
      title={title ?? `${rankName(face.rank)} ${SUIT_SYMBOL[face.suit]}`}
      data-card-id={cardId}
    >
      <span className="corner">
        {rankLabel(face.rank)}
        <small>{SUIT_SYMBOL[face.suit]}</small>
      </span>
      <span className="pip">{SUIT_SYMBOL[face.suit]}</span>
    </div>
  );
}

interface MatProps {
  cards: CardView[];
  color: string;
  draggable?: boolean;
  selectable?: Set<string> | 'all' | null;
  selected?: string | null;
  onTap?: (cardId: string) => void;
  onMove?: (cardId: string, x: number, y: number) => void;
  onDropDiscard?: (cardId: string) => void;
  small?: boolean;
  /** Cartes à ne pas encore afficher : le temps qu'une carte volante (FlyingCard) arrive à cet
   * emplacement, pour que le tapis montre bien une carte de moins pendant tout l'échange. */
  hidden?: Set<string>;
}

interface Drag {
  id: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  card: CardView;
}

const discardEl = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-drop="discard"]');

function overDiscard(x: number, y: number): boolean {
  const el = discardEl();
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const pad = 18;
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

/**
 * Tapis d'un joueur : cartes positionnées librement (pourcentages).
 * Glisser une carte : elle suit le doigt/la souris partout à l'écran ; lâchée sur la défausse,
 * c'est une demande de défausse rapide ; lâchée sur le tapis, elle change de place.
 */
export function Mat({ cards, color, draggable, selectable, selected, onTap, onMove, onDropDiscard, small, hidden }: MatProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Position posée localement en attendant la confirmation du serveur (évite tout saut visuel).
  const [settled, setSettled] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ id: string; sx: number; sy: number; moved: boolean; width: number; height: number } | null>(null);

  const canTap = (id: string) => selectable === 'all' || (selectable instanceof Set && selectable.has(id));

  const setHot = (hot: boolean) => discardEl()?.classList.toggle('hot', hot);

  const visible = hidden?.size ? cards.filter((c) => !hidden.has(c.id)) : cards;

  return (
    <div className={`mat ${small ? 'small' : ''}`} ref={ref} style={{ ['--mat' as string]: color }}>
      {visible.map((c) => {
        const dragging = drag?.id === c.id;
        const red = c.redUntil !== null;
        const sel = selected === c.id;
        const tappable = canTap(c.id);
        const local = settled?.id === c.id ? settled : null;
        const pos = local ?? c.pos;
        return (
          <div
            key={c.id}
            className={`slot ${dragging ? 'lifted' : ''} ${local ? 'settle' : ''} ${red ? 'penalty' : ''} ${sel ? 'selected' : ''} ${tappable ? 'tappable' : ''} ${draggable ? 'movable' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            data-card-id={c.id}
            onPointerDown={(e) => {
              if (!onTap && !draggable) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const box = e.currentTarget.getBoundingClientRect();
              gesture.current = { id: c.id, sx: e.clientX, sy: e.clientY, moved: false, width: box.width, height: box.height };
            }}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!g || g.id !== c.id) return;
              if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) {
                if (!draggable) return;
                g.moved = true;
              }
              if (g.moved) {
                setDrag({ id: c.id, cx: e.clientX, cy: e.clientY, width: g.width, height: g.height, card: c });
                setHot(overDiscard(e.clientX, e.clientY));
              }
            }}
            onPointerUp={(e) => {
              const g = gesture.current;
              gesture.current = null;
              setHot(false);
              if (!g || g.id !== c.id) return;
              if (g.moved) {
                setDrag(null);
                if (overDiscard(e.clientX, e.clientY)) {
                  onDropDiscard?.(c.id);
                  return;
                }
                const r = ref.current!.getBoundingClientRect();
                const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
                if (inside) {
                  const x = Math.min(94, Math.max(6, ((e.clientX - r.left) / r.width) * 100));
                  const y = Math.min(94, Math.max(6, ((e.clientY - r.top) / r.height) * 100));
                  setSettled({ id: c.id, x, y });
                  setTimeout(() => setSettled((s) => (s?.id === c.id ? null : s)), 700);
                  onMove?.(c.id, x, y);
                } // sinon : la carte retourne à sa place
              } else {
                onTap?.(c.id);
              }
            }}
            onPointerCancel={() => {
              gesture.current = null;
              setDrag(null);
              setHot(false);
            }}
          >
            <Card face={c.face} className={red ? 'flash' : ''} />
          </div>
        );
      })}
      {drag &&
        createPortal(
          <div className="drag-ghost" style={{ left: drag.cx, top: drag.cy, width: drag.width, height: drag.height }}>
            <Card face={drag.card.face} className="no-flip" />
          </div>,
          document.body,
        )}
    </div>
  );
}

export interface FlightSpec {
  id: number;
  from: DOMRect;
  to: DOMRect;
  duration?: number;
}

/**
 * Carte volante : décrit un arc au-dessus du plateau entre deux emplacements (via une animation CSS
 * à base de variables --x0/--y0/--x1/--y1, voir .fly-card dans mabrouk.css), assez lente pour bien
 * montrer QUELLE carte part et OÙ elle arrive. Rendue en portail dans <body>, comme .drag-ghost.
 * Toujours affichée dos visible (jamais la face) : la carte reste secrète pendant tout le vol, quel
 * que soit l'échange (avec la pioche tenue, la défausse, ou entre deux joueurs) — voir Game.tsx.
 */
export function FlyingCard({ from, to, duration = 1 }: { from: DOMRect; to: DOMRect; duration?: number }) {
  const dist = Math.hypot(to.left - from.left, to.top - from.top);
  const lift = Math.max(70, Math.min(160, dist * 0.22));
  const style = {
    '--x0': `${from.left}px`,
    '--y0': `${from.top}px`,
    '--w0': `${from.width}px`,
    '--h0': `${from.height}px`,
    '--x1': `${to.left}px`,
    '--y1': `${to.top}px`,
    '--w1': `${to.width}px`,
    '--h1': `${to.height}px`,
    '--lift': `${lift}px`,
    animationDuration: `${duration}s`,
  } as React.CSSProperties;
  return createPortal(
    <div className="fly-card" style={style}>
      <Card face={null} className="no-flip" />
    </div>,
    document.body,
  );
}
