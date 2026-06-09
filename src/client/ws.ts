// ============================================================================
// ws.ts — the single WebSocket connection to the daemon, with bounded
// jittered-backoff reconnect. Feeds messages into the store and registers the
// send function. Same relative /ws URL works in dev (Vite proxy) and prod.
// ============================================================================

import { ClientMessage, ServerMessage } from '../shared/contract';
import { useStore, resubscribe } from './store';

let socket: WebSocket | null = null;
let backoff = 500;
// Cap low so a daemon restart (e.g. the launcher replacing a stale daemon) is
// picked up within a couple seconds — no manual refresh. cmux reads are free, so
// a tight reconnect costs nothing.
const MAX_BACKOFF = 3_000;
const queue: ClientMessage[] = [];
const QUEUE_MAX = 100; // offline actions are user-driven; bound it regardless

function flush(): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    while (queue.length) socket.send(JSON.stringify(queue.shift()));
  }
}

function wsSend(m: ClientMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  else {
    queue.push(m); // sent on (re)connect
    if (queue.length > QUEUE_MAX) queue.shift();
  }
}

export function connectWs(): void {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const ws = new WebSocket(url);
  socket = ws;
  useStore.getState().setSend(wsSend);

  ws.onopen = () => {
    backoff = 500;
    useStore.getState().setConnected(true);
    flush();
    // Re-announce the current view: a restarted daemon has empty view state, and
    // without this an already-expanded terminal would never resume its stream.
    resubscribe();
  };
  ws.onmessage = (ev) => {
    try {
      const msg: ServerMessage = JSON.parse(ev.data);
      useStore.getState().handleMessage(msg);
    } catch {
      /* ignore malformed */
    }
  };
  ws.onclose = () => {
    useStore.getState().setConnected(false);
    socket = null;
    const jitter = Math.random() * 250;
    setTimeout(connectWs, Math.min(backoff, MAX_BACKOFF) + jitter);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  };
  ws.onerror = () => ws.close();
}
