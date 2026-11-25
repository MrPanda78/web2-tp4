import { createServer, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { CatalogError, fetchProduct, port } from './catalog';
import { CatalogProduct, ClientMessage, MessageError, parseMessage, ProposalFailure, RankedProduct, ScreenState, ServerMessage } from './contract';

type Participant = { id: string; name: string };
type Entry = { product: CatalogProduct; proposedBy: string; voters: Set<string> };
const participants = new Map<WebSocket, Participant>();
const products = new Map<number, Entry>();
const screens = new Set<ServerResponse>();
const publicDir = join(__dirname, '..', 'public');
const assets: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/pantalla': ['pantalla.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/common.js': ['common.js', 'text/javascript; charset=utf-8'],
  '/participant.js': ['participant.js', 'text/javascript; charset=utf-8'],
  '/screen.js': ['screen.js', 'text/javascript; charset=utf-8']
};

function ranking(): RankedProduct[] {
  return [...products.values()]
    .map(e => ({ ...e.product, proposedBy: e.proposedBy, votes: e.voters.size }))
    .sort((a, b) => b.votes - a.votes || a.id - b.id);
}
function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function sendScreen(res: ServerResponse, state: ScreenState) {
  if (!res.destroyed && !res.writableEnded) {
    res.write(`event: ranking\ndata: ${JSON.stringify(state)}\n\n`);
  } else screens.delete(res);
}
function screenState(ranked = ranking()): ScreenState {
  return { type: 'ranking', participantCount: participants.size, products: ranked };
}
function broadcast() {
  const ranked = ranking();
  const names = [...participants.values()].map(p => p.name);
  for (const [ws, p] of participants) {
    send(ws, { type: 'state', participants: names, products: ranked.map(product => ({
      ...product, votedByMe: products.get(product.id)!.voters.has(p.id)
    })) });
  }
  for (const res of screens) sendScreen(res, screenState(ranked));
}
function disconnect(ws: WebSocket) {
  const p = participants.get(ws);
  if (!p) return;
  participants.delete(ws);
  // El voto pertenece a la conexión: al salir se elimina, evitando votos huérfanos.
  for (const entry of products.values()) entry.voters.delete(p.id);
  broadcast();
}
function duplicate(id: number): ProposalFailure {
  return { id, code: 'duplicate', message: 'El producto ya está en la lista.' };
}
async function propose(ws: WebSocket, p: Participant, ids: number[]) {
  type Outcome = { product: CatalogProduct } | { failure: ProposalFailure };
  // Todas las solicitudes empiezan juntas. No se bloquea el event loop.
  const outcomes = await Promise.all(ids.map(async (id): Promise<Outcome> => {
    if (products.has(id)) return { failure: duplicate(id) };
    try { return { product: await fetchProduct(id) }; }
    catch (e) {
      const err = e instanceof CatalogError ? e : new CatalogError('catalog_error', 'Error de catálogo.');
      return { failure: { id, code: err.code, message: err.message } };
    }
  }));
  // Una propuesta de una conexión que ya salió no debe modificar la lista.
  if (participants.get(ws) !== p || ws.readyState !== WebSocket.OPEN) return;
  const added: number[] = [];
  const failures: ProposalFailure[] = [];
  // Sección síncrona sin await: volver a comprobar y agregar atómicamente.
  for (const outcome of outcomes) {
    if ('failure' in outcome) { failures.push(outcome.failure); continue; }
    const { product } = outcome;
    if (products.has(product.id)) { failures.push(duplicate(product.id)); continue; }
    products.set(product.id, { product, proposedBy: p.name, voters: new Set() });
    added.push(product.id);
  }
  if (added.length) broadcast();
  send(ws, { type: 'proposal_result', added, failures });
}
async function handle(ws: WebSocket, msg: ClientMessage) {
  if (msg.type === 'join') {
    if (participants.has(ws)) throw new MessageError('already_joined', 'Ya ingresaste.');
    if ([...participants.values()].some(p => p.name.toLowerCase() === msg.name.toLowerCase())) {
      throw new MessageError('name_taken', 'Ese nombre ya está conectado.');
    }
    participants.set(ws, { id: randomUUID(), name: msg.name });
    send(ws, { type: 'joined', name: msg.name });
    broadcast();
    return;
  }
  const p = participants.get(ws);
  if (!p) throw new MessageError('not_joined', 'Primero debes ingresar con un nombre.');
  if (msg.type === 'propose') { await propose(ws, p, msg.ids); return; }
  const entry = products.get(msg.productId);
  if (!entry) throw new MessageError('product_not_found', 'El producto no está en la lista.');
  // Todas las operaciones de voto y eliminación son síncronas y validadas.
  switch (msg.type) {
    case 'vote':
      if (entry.voters.has(p.id)) throw new MessageError('already_voted', 'Ya votaste este producto.');
      entry.voters.add(p.id);
      break;
    case 'unvote':
      if (!entry.voters.has(p.id)) throw new MessageError('not_voted', 'No tienes un voto para retirar.');
      entry.voters.delete(p.id);
      break;
    case 'remove':
      // Regla elegida: cualquier participante conectado puede quitar un producto.
      products.delete(msg.productId);
      break;
  }
  broadcast();
}
const server = createServer(async (req, res) => {
  if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end(); return; }
  const path = (req.url || '/').split('?')[0];
  if (path === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    screens.add(res);
    res.on('close', () => screens.delete(res));
    res.on('error', () => screens.delete(res));
    sendScreen(res, screenState());
    return;
  }
  const asset = Object.hasOwn(assets, path) ? assets[path] : undefined;
  if (!asset) { res.writeHead(404).end('No encontrado'); return; }
  try {
    const body = await readFile(join(publicDir, asset[0]));
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(body);
  } catch { res.writeHead(500).end('Error al leer el archivo'); }
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', ws => {
  ws.on('message', (data, isBinary) => {
    // Cada mensaje tiene su propio manejo de errores; las propuestas no forman una cola global.
    void (async () => {
      try {
        if (isBinary) throw new MessageError('invalid_message', 'Solo se aceptan mensajes JSON de texto.');
        await handle(ws, parseMessage(data.toString()));
      } catch (err) {
        if (err instanceof MessageError) send(ws, { type: 'error', code: err.code, message: err.message });
        else { console.error(err); send(ws, { type: 'error', code: 'internal_error', message: 'Error interno.' }); }
      }
    })();
  });
  ws.on('close', () => disconnect(ws));
  ws.on('error', () => { disconnect(ws); ws.terminate(); });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Participantes: http://localhost:${port}/`);
  console.log(`Pantalla:      http://localhost:${port}/pantalla`);
});
