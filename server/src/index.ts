import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 8787);
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, '../../client/dist');

startServer({ port, staticDir }).then((s) => {
  console.log(`Mabrouk : serveur prêt sur http://localhost:${s.port} (WebSocket /ws)`);
});
