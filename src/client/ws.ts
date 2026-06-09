// ============================================================================
// ws.ts — the single WebSocket connection to the daemon, with bounded
// jittered-backoff reconnect. Feeds messages into the store and registers the
// send function. Same relative /ws URL works in dev (Vite proxy) and prod.
// ============================================================================

import { ClientMessage, ServerMessage } from '../shared/contract';
import { useStore } from './store';

let socket: WebSocket | null = null;
let backoff = 500;
// Cap low so a daemon restart (e.g. the launcher replacing a stale daemon) is
// picked up within a couple seconds — no manual refresh. cmux reads are free, so
// a tight reconnect costs nothing.
const MAX_BACKOFF = 3_000;
const queue: ClientMessage[] = [];

function flush(): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    while (queue.length) socket.send(JSON.stringify(queue.shift()));
  }
}

function wsSend(m: ClientMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  else queue.push(m); // sent on (re)connect
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
