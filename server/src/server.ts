// NETWORKING : serveur WebSocket autoritaire. Toute la logique est dans @mabrouk/core (Hub/Room/engine) ;
// ici on ne fait que transporter les messages et fournir l'aléatoire cryptographique.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Hub } from '@mabrouk/core';
import type { ClientMsg, ServerMsg } from '@mabrouk/core';
import { WebSocketServer, type WebSocket } from 'ws';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export interface ServerOptions {
  port: number;
  /** Dossier du client compilé (client/dist) servi en statique s'il existe. */
  staticDir?: string;
}

export function crypto32(n: number): number[] {
  const buf = randomBytes(n * 4);
  return Array.from({ length: n }, (_, i) => buf.readUInt32LE(i * 4));
}

export function startServer(opts: ServerOptions): Promise<{ port: number; close: () => Promise<void>; hub: Hub }> {
  const sockets = new Map<string, WebSocket>();
  let nextConn = 1;

  const hub = new Hub({
    now: () => Date.now(),
    schedule: (fn, ms) => {
      setTimeout(fn, ms).unref?.();
    },
    rand32: crypto32,
    sendConn: (connId, msg: ServerMsg) => {
      const ws = sockets.get(connId);
      if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
  });

  const server = http.createServer((req, res) => {
    const dir = opts.staticDir;
    if (!dir || !fs.existsSync(dir)) {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Mabrouk : serveur de jeu actif. Lancez le client avec `npm run dev:client`.');
      return;
    }
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.normalize(path.join(dir, url));
    if (!file.startsWith(path.normalize(dir))) {
      res.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    const size = fs.statSync(file).size;
    const type = MIME[path.extname(file)] ?? 'application/octet-stream';
    // Requêtes Range : nécessaires à la lecture/boucle de la musique dans certains navigateurs.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': end - start + 1,
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
    fs.createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    const connId = 'c' + nextConn++;
    sockets.set(connId, ws);
    let windowStart = Date.now();
    let count = 0;
    let alive = true;
    ws.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);

    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > 40) return; // anti-flood
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data.toString()) as ClientMsg;
      } catch {
        ws.send(JSON.stringify({ t: 'error', message: 'Message illisible.' } satisfies ServerMsg));
        return;
      }
      hub.handle(connId, msg);
    });

    ws.on('close', () => {
      clearInterval(ping);
      sockets.delete(connId);
      hub.disconnect(connId);
    });
    ws.on('error', () => ws.terminate());
  });

  return new Promise((resolve) => {
    server.listen(opts.port, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      resolve({
        port,
        hub,
        close: () =>
          new Promise<void>((done) => {
            for (const ws of sockets.values()) ws.terminate();
            wss.close(() => server.close(() => done()));
          }),
      });
    });
  });
}
