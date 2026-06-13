// ============================================================================
// cmux adapter — talks to the cmux control socket over a SINGLE PERSISTENT
// connection using newline-delimited JSON-RPC. Verified live against cmux
// 0.64.10 on 2026-06-06.
//
// Why a persistent socket (not the `cmux` CLI): each CLI call spawns a 13MB
// process and opens a fresh socket connection; under continuous polling the
// socket trips into refusing connections (EPIPE / "Broken pipe"). One reused
// socket connection is gentle, fast, and survives bursts (verified: 20 rapid
// system.top over one connection → 0 failures).
//
// Wire format (verified):
//   send:  {"id":N,"method":"system.top","params":{"all":true}}\n
//   recv:  {"result":{...},"ok":true,"id":N}\n   (errors: {"ok":false,"error":...})
// ============================================================================

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const REQ_TIMEOUT_MS = 8000;

const CMUX_DIR = `${process.env.HOME}/Library/Application Support/cmux`;

// Resolve cmux's control socket fresh on every (re)connect — never hardcode the
// UID. Order: explicit override → cmux-<uid>.sock (cmux's own naming) → the
// newest cmux-*.sock actually on disk (covers non-501 UIDs and cmux relaunches
// that mint a new socket). Re-resolving each connect is what lets the daemon
// survive a cmux restart without a daemon restart.
function resolveSocketPath(): string {
  if (process.env.CMUX_SOCKET_PATH) return process.env.CMUX_SOCKET_PATH;
  const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
  const byUid = path.join(CMUX_DIR, `cmux-${uid}.sock`);
  try {
    if (fs.statSync(byUid).isSocket()) return byUid;
  } catch {
    /* fall through to scan */
  }
  try {
    const socks = fs
      .readdirSync(CMUX_DIR)
      .filter((f) => f.startsWith('cmux-') && f.endsWith('.sock'))
      .map((f) => {
        const p = path.join(CMUX_DIR, f);
        return { p, mtime: fs.statSync(p).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    if (socks.length) return socks[0].p;
  } catch {
    /* dir missing — fall back to the uid guess */
  }
  return byUid;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  timer: NodeJS.Timeout;
}

let sock: net.Socket | null = null;
let connecting: Promise<net.Socket> | null = null;
let nextId = 1;
let rxBuf = '';
const pending = new Map<number, Pending>();

function failAll(err: Error): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

let keepalive: NodeJS.Timeout | null = null;

function connect(): Promise<net.Socket> {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  if (connecting) return connecting;
  connecting = new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(resolveSocketPath());
    s.setNoDelay(true);
    s.on('connect', () => {
      sock = s;
      connecting = null;
      // Start this connection with a clean receive buffer. The old socket's
      // 'close' normally clears rxBuf, but a destroy()-on-timeout may not emit
      // 'close' before this new socket goes live; a leftover partial frame would
      // then corrupt the first frame read here.
      rxBuf = '';
      // Keepalive: a dead/half-open cmux socket may never emit 'close'. Ping
      // periodically; a failed ping destroys the socket so the next call
      // reconnects fresh — this is what makes the daemon self-heal.
      if (keepalive) clearInterval(keepalive);
      // Interval is deliberately larger than REQ_TIMEOUT_MS so a slow-but-alive
      // cmux isn't torn down every cycle.
      keepalive = setInterval(() => {
        // Guard on `s`: if a reconnect already replaced the live socket, this
        // stale timer must not tear down the new one.
        if (s !== sock) return;
        rpc('system.ping').catch(() => {
          if (s === sock && !s.destroyed) s.destroy();
        });
      }, 12000);
      resolve(s);
    });
    s.on('data', (chunk: Buffer) => {
      rxBuf += chunk.toString('utf8');
      let nl: number;
      while ((nl = rxBuf.indexOf('\n')) >= 0) {
        const line = rxBuf.slice(0, nl);
        rxBuf = rxBuf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const p = msg.id != null ? pending.get(msg.id) : undefined;
        if (!p) continue;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        // Reject on an explicit ok:false OR a standard JSON-RPC `error` member —
        // a future/standard cmux build that drops the `ok` envelope must not have
        // an error frame silently resolve as a successful `undefined` result.
        if (msg.ok === false || msg.error != null) p.reject(new Error(`cmux error: ${JSON.stringify(msg.error || msg)}`));
        else p.resolve(msg.result);
      }
    });
    s.on('error', (e) => {
      if (!sock) {
        connecting = null;
        reject(e);
      }
      // Only fail in-flight requests if THIS socket is the live one — a delayed
      // 'error' from a socket we already replaced must not reject the new socket's
      // healthy requests.
      if (s === sock || !sock) failAll(e);
    });
    s.on('close', () => {
      // Ignore a stale 'close' from a socket a reconnect already replaced —
      // otherwise it would null out the live socket, stop its keepalive, and
      // spuriously reject its in-flight requests.
      if (s !== sock) return;
      sock = null;
      rxBuf = '';
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
      failAll(new Error('cmux socket closed'));
    });
  });
  return connecting;
}

/** Call a cmux RPC method over the persistent socket; returns its `result`. */
export async function rpc<T = any>(method: string, params?: object): Promise<T> {
  const s = await connect();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A timeout means the socket is likely stale/half-open — drop it so the
      // next call reconnects instead of reusing a dead connection. Only destroy
      // it if it's still the live socket (a reconnect may have replaced it). Also
      // fail the OTHER in-flight requests on this dead socket immediately rather
      // than letting each wait out its own timeout — `destroy()` does not reliably
      // emit 'close' in every libuv state, so don't depend on it to fail them.
      if (s === sock && !s.destroyed) {
        s.destroy();
        failAll(new Error('cmux socket torn down (request timeout)'));
      }
      reject(new Error(`cmux ${method} timed out`));
    }, REQ_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    s.write(JSON.stringify({ id, method, params: params || {} }) + '\n', (err) => {
      if (err) {
        clearTimeout(timer);
        pending.delete(id);
        reject(err);
      }
    });
  });
}

// ---- Raw cmux shapes (only the fields we consume) ----
export interface RawResources {
  cpu_percent: number;
  memory_bytes: number;
  resident_bytes?: number;
  pids: number[];
  process_count: number;
}
export interface RawSurface {
  id: string;
  ref: string;
  type: 'terminal' | 'browser' | string;
  title: string;
  url?: string;
  resources?: RawResources;
  root_pids?: number[];
  tty_process_pids?: number[];
  top_level_pids?: number[];
}
export interface RawPane {
  id: string;
  ref: string;
  surfaces: RawSurface[];
}
export interface RawWorkspace {
  id: string;
  ref: string;
  title?: string;
  panes: RawPane[];
}
export interface RawWindow {
  id: string;
  ref: string;
  workspaces: RawWorkspace[];
}
export interface RawCodingAgent {
  id: string;
  display_name: string;
  resources?: RawResources;
}
export interface RawTop {
  windows: RawWindow[];
  coding_agents: RawCodingAgent[];
  active?: { surface_id?: string };
}

/** One heartbeat call: topology + titles + per-surface resources + claude pid set. */
export function systemTop(): Promise<RawTop> {
  return rpc<RawTop>('system.top', { all: true });
}

export interface ReadTextResult {
  text: string;
  surface_ref: string;
  surface_id: string;
}
/** Read a surface's current viewport (plain text, no scrollback, no ANSI). */
export function readText(surfaceId: string): Promise<ReadTextResult> {
  return rpc<ReadTextResult>('surface.read_text', { surface_id: surfaceId });
}

/** Send text to a surface. `text` should include a trailing "\n" to submit. */
export function sendText(surfaceId: string, text: string): Promise<any> {
  return rpc('surface.send_text', { surface_id: surfaceId, text });
}

/** Send a single key event (e.g. "enter", "ctrl+c"). */
export function sendKey(surfaceId: string, key: string): Promise<any> {
  return rpc('surface.send_key', { surface_id: surfaceId, key });
}

export interface RawSurfaceListItem {
  id: string;
  ref: string;
  type: string;
  title: string;
  requested_working_directory?: string | null;
  resume_binding?: { kind?: string; cwd?: string } | null;
}
/** Per-workspace surface.list — the only source of cwd / resume_binding.kind.
 *  Must pass the workspace UUID as `workspace_id` — a `workspace` ref is IGNORED
 *  and silently returns the ACTIVE workspace's surfaces (→ every agent gets the
 *  wrong cwd). Verified against cmux. */
export async function surfaceListForWorkspace(workspaceId: string): Promise<RawSurfaceListItem[]> {
  const r = await rpc<{ surfaces: RawSurfaceListItem[] }>('surface.list', { workspace_id: workspaceId });
  return r.surfaces || [];
}

export interface FeedItem {
  id: string;
  kind: string;
  source: string;
  status?: string;
  title?: string;
  tool_name?: string;
  workstream_id?: string;
  cwd?: string;
  created_at?: string;
  updated_at?: string;
}
export async function feedList(): Promise<FeedItem[]> {
  const r = await rpc<{ items: FeedItem[] }>('feed.list');
  return r.items || [];
}

/** Tear down the socket + keepalive (clean shutdown). */
export function close(): void {
  if (keepalive) {
    clearInterval(keepalive);
    keepalive = null;
  }
  failAll(new Error('shutdown'));
  if (sock) sock.destroy();
  sock = null;
  connecting = null;
}

/** Quick liveness probe. */
export async function ping(): Promise<boolean> {
  try {
    await rpc('system.ping');
    return true;
  } catch {
    return false;
  }
}
