// ============================================================================
// index.ts — the Overseer daemon. Serves the built SPA (single origin),
// /health, a tiny REST surface, and the /ws push channel. Owns the Fleet +
// Autopilot and fans their events out to all connected clients.
// Binds 127.0.0.1 only (local-only non-negotiable).
// ============================================================================

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  Agent,
  ClientMessage,
  HealthResponse,
  OVERSEER_VERSION,
  ServerMessage,
} from '../shared/contract';
import { Fleet } from './poller';
import { Autopilot } from './autopilot';
import { DecisionLog } from './decisionlog';
import * as cmux from './cmux';
import { getBrainModel, setBrainModel, BRAIN_MODELS } from './brain';
import { initOrders, getOrders, setOrders, pruneOrders } from './orders';

const PORT = Number(process.env.OVERSEER_PORT || 7878);
const HOST = '127.0.0.1';
const OVERSEER_DIR = process.env.OVERSEER_DIR || join(__dirname, '..', '..');
const CLIENT_DIR = join(OVERSEER_DIR, 'dist', 'client');
const RUN_DIR = join(OVERSEER_DIR, '.overseer');
const startedAt = Date.now();

const log = new DecisionLog(join(RUN_DIR, 'decisions.jsonl'));
initOrders(join(RUN_DIR, 'orders.json'));
const fleet = new Fleet();
const autopilot = new Autopilot(log, (id) => fleet.getAgent(id), (id) => fleet.getFullScreen(id));

// ---- enrich fleet agents with live autopilot display state ----
function enrich(agents: Agent[]): Agent[] {
  return agents.map((a) => {
    const waiting = a.state === 'waiting-permission' || a.state === 'waiting-question';
    const display = autopilot.displayState(a.id);
    const deferred = autopilot.isDeferred(a.id, a.question || '', a.options || []);
    return {
      ...a,
      autopilotEnabled: autopilot.isAgentEnabled(a.id),
      autopilot: display,
      needsInput: waiting && (display === 'off' || deferred),
    };
  });
}

// When autopilot is turned ON, immediately handle any agent that is ALREADY
// sitting in a waiting state (otherwise it'd only fire when the screen next
// changes — i.e. "I armed it but it didn't answer the stuck agent").
function rescanWaiting(): void {
  for (const a of fleet.getAgents()) {
    if (a.state === 'waiting-permission' || a.state === 'waiting-question') {
      autopilot.onWaiting(a).catch(() => {});
    }
  }
}

// ---- broadcast helpers ----
const clients = new Set<WebSocket>();
function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(data);
}
function broadcastAgents(): void {
  const agents = fleet.getAgents();
  const live = new Set(agents.map((a) => a.id));
  autopilot.retain(live); // prune state for departed agents
  if (agents.length) pruneOrders(live); // per-agent orders die with their surface
  broadcast({ type: 'agents', agents: enrich(agents) });
}

let cmuxOk = true;
fleet.on('agents', () => broadcastAgents());
fleet.on('screen', (p: { id: string; fullText: string }) =>
  broadcast({ type: 'agentScreen', id: p.id, fullText: p.fullText }),
);
fleet.on('cmux', (ok: boolean, message?: string) => {
  cmuxOk = ok;
  broadcast({ type: 'cmux', ok, message });
});
fleet.on('waiting', (a: Agent) => {
  autopilot.onWaiting(a).catch(() => {});
});
autopilot.on('decision', (d) => {
  broadcast({ type: 'decision', decision: d });
  broadcastAgents(); // ring/needs-you state may have changed
});
autopilot.on('agentchange', () => broadcastAgents());

// ---- static file serving ----
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // decodeURIComponent throws on malformed escapes (e.g. "/%zz") — treat those
  // as a plain 404 instead of letting the request handler reject.
  let urlPath: string;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '') rel = '/index.html';
  let filePath = join(CLIENT_DIR, rel);
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    filePath = join(CLIENT_DIR, 'index.html'); // SPA fallback
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found (build the client: npm run build)');
  }
}

// Security: only accept connections from the local app origin (or no Origin —
// a non-browser local tool, which already has socket access anyway). This blocks
// cross-site WebSocket hijacking / CSRF from any webpage the user happens to
// visit (browsers always send Origin cross-site; binding to 127.0.0.1 alone does
// NOT stop a malicious page from reaching ws://localhost).
function originAllowed(origin?: string): boolean {
  if (!origin) return true; // curl / local scripts / same-process tools
  try {
    const u = new URL(origin);
    return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && String(u.port || '') === String(PORT);
  } catch {
    return false;
  }
}

const MAX_BODY_BYTES = 256 * 1024; // POST bodies are tiny (surfaceId + text); cap to bound memory
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      data += c;
      if (data.length > MAX_BODY_BYTES) {
        aborted = true;
        data = '';
        req.destroy();
        resolve({});
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// ---- HTTP server ----
const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res);
  } catch (e) {
    // A request must never take the daemon down. Answer 500 if we still can.
    try {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('internal error');
    } catch {
      /* socket already gone */
    }
  }
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = (req.url || '/').split('?')[0];

  if (url === '/health') {
    const body: HealthResponse = {
      ok: true,
      version: OVERSEER_VERSION,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      agentsTracked: fleet.getAgents().length,
      cmuxOk,
      cmuxReady: fleet.cmuxReady(),
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }

  if (req.method === 'POST' && (url === '/api/send' || url === '/api/test/register')) {
    if (!originAllowed(req.headers.origin)) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }));
      return;
    }
  }

  // NOTE: /api/send intentionally has no two-step confirm (unlike the WS `send`
  // path) — it's 127.0.0.1-only + Origin-gated and just types into a terminal
  // (zero tokens). Kept for scripted/local use.
  if (req.method === 'POST' && url === '/api/send') {
    const { surfaceId, text } = await readBody(req);
    const known = !!fleet.getAgent(surfaceId);
    let ok = known && typeof text === 'string';
    let error: string | undefined;
    if (ok) {
      try {
        await cmux.sendText(surfaceId, text);
      } catch (e: any) {
        // Report the real outcome — don't claim the keystroke landed if it threw.
        ok = false;
        error = e?.message || 'send failed';
      }
    } else if (!known) {
      error = 'unknown surface';
    }
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, ...(error ? { error } : {}) }));
    return;
  }

  if (req.method === 'POST' && url === '/api/test/register' && process.env.OVERSEER_TEST === '1') {
    // verification-only: force-classify a surface (e.g. a dummy) as an agent.
    const { surfaceId } = await readBody(req);
    if (surfaceId) fleet.registerTestAgent(surfaceId);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  await serveStatic(req, res);
}

// ---- WebSocket ----
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info: { origin?: string }) => originAllowed(info.origin),
});
// The wss shares the http server, so a listen EADDRINUSE surfaces here too.
// Swallow it quietly — the http server's own 'error' handler (below) owns the
// clean "another daemon already running → exit 0" path. Without this, ws's
// unhandled 'error' crashes the duplicate with an ugly stack first.
wss.on('error', (err: NodeJS.ErrnoException) => {
  // EADDRINUSE is expected on a duplicate launch — the http 'error' handler owns
  // the clean exit(0). Anything else is a real fault: surface it, don't hide it.
  if (err?.code !== 'EADDRINUSE') console.error('overseer: websocket server error', err);
});
wss.on('connection', (ws) => {
  clients.add(ws);
  send(ws, {
    type: 'snapshot',
    agents: enrich(fleet.getAgents()),
    master: autopilot.getMaster(),
    cmuxOk,
    serverTime: Date.now(),
    shadowMode: autopilot.isShadowMode(),
    brainModel: getBrainModel(),
    brainModels: BRAIN_MODELS,
    orders: getOrders(),
  });
  send(ws, { type: 'decisionsInit', decisions: autopilot.getDecisions(), costTodayUsd: autopilot.getCostToday() });

  ws.on('message', async (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      await handleClientMessage(ws, msg);
    } catch {
      /* a malformed message must never take the daemon down */
    }
  });

  async function handleClientMessage(ws: WebSocket, msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'subscribe': {
        fleet.setView(msg.visibleIds, msg.expandedId);
        if (msg.expandedId) {
          // Send the already-built transcript instantly (no "loading" wait),
          // then trigger a fresh read for the very latest.
          const existing = fleet.getFullScreen(msg.expandedId);
          if (existing) send(ws, { type: 'agentScreen', id: msg.expandedId, fullText: existing });
          fleet.pokeRead(msg.expandedId).catch(() => {});
        }
        break;
      }
      case 'send':
        if (msg.confirmed && fleet.getAgent(msg.surfaceId)) {
          try {
            await cmux.sendText(msg.surfaceId, msg.text);
            fleet.pokeRead(msg.surfaceId).catch(() => {}); // show it instantly
          } catch (e: any) {
            send(ws, { type: 'toast', level: 'error', text: `Send failed: ${e?.message || 'error'}` });
          }
        }
        break;
      case 'answer':
        try {
          await autopilot.humanAnswer(msg.surfaceId, msg.text);
          fleet.pokeRead(msg.surfaceId).catch(() => {});
          broadcastAgents();
        } catch (e: any) {
          send(ws, { type: 'toast', level: 'error', text: `Answer failed: ${e?.message || 'error'}` });
        }
        break;
      case 'interrupt':
        // Stop the agent in the real cmux terminal — exactly Ctrl+C at its prompt.
        // No toast: it's a quiet, idempotent keystroke; the terminal itself shows
        // the result (⎿ Interrupted), and a no-op at an idle prompt is harmless.
        if (fleet.getAgent(msg.surfaceId)) {
          try {
            await cmux.sendKey(msg.surfaceId, 'ctrl+c');
            fleet.pokeRead(msg.surfaceId).catch(() => {}); // reflect the stop instantly
          } catch {
            /* swallow — the user can see the terminal; a failed keystroke is not worth a popup */
          }
        }
        break;
      case 'setAutopilot':
        autopilot.setAgentEnabled(msg.surfaceId, msg.enabled);
        if (msg.enabled) {
          const a = fleet.getAgent(msg.surfaceId);
          if (a && (a.state === 'waiting-permission' || a.state === 'waiting-question')) {
            autopilot.onWaiting(a).catch(() => {});
          }
        }
        break;
      case 'setMaster':
        autopilot.setMaster(msg.enabled);
        if (msg.enabled) rescanWaiting(); // act on already-waiting agents now
        broadcast({ type: 'master', master: autopilot.getMaster() });
        break;
      case 'setBrainModel':
        // No toast — the model button itself updates to the new label, that's feedback enough.
        if (setBrainModel(msg.model)) broadcast({ type: 'brainModel', model: getBrainModel() });
        break;
      case 'setOrders':
        // Standing orders for the brain — global (surfaceId null) or per-agent.
        setOrders(msg.surfaceId ?? null, String(msg.text ?? ''));
        broadcast({ type: 'orders', orders: getOrders() });
        break;
      case 'recallAll':
        autopilot.recallAll();
        broadcast({ type: 'master', master: false });
        broadcast({ type: 'toast', level: 'info', text: 'Fleet recalled — autopilot disarmed everywhere' });
        break;
    }
  }

  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// Conflict resolution: if another daemon already owns the port, exit cleanly and
// immediately rather than lingering as a zombie. One stable listener always wins;
// duplicates self-resolve instead of fighting over the socket.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(`overseer: port ${PORT} already served by another daemon — exiting (no duplicate).`);
    process.exit(0);
  }
  // eslint-disable-next-line no-console
  console.error('overseer: fatal server error', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`overseer daemon listening on http://${HOST}:${PORT}`);
  fleet.start();
});

function shutdown(): void {
  fleet.stop();
  for (const ws of clients) ws.terminate();
  // Drop idle HTTP keep-alive sockets too, so the listen port frees immediately
  // instead of lingering ~1.5s — otherwise a fast relaunch races us for the port.
  (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
