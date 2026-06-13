// ============================================================================
// orders.ts — standing orders: the human's written directive the brain must
// obey when it answers on their behalf ("prefer npm over pnpm", "never touch
// the staging DB", "always pick the conservative option in this repo").
// Global orders persist to .overseer/orders.json; per-agent orders are keyed
// by surface id (ephemeral across cmux restarts, persisted anyway — harmless).
// ============================================================================

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { OrdersState } from '../shared/contract';

const MAX_LEN = 2000; // a directive is a paragraph, not a novel — bound it

let filePath = '';
let state: OrdersState = { global: '', perAgent: {} };

// A per-agent key is a cmux surface id. Reject anything that isn't a plain
// non-empty string, and never let the special object keys through (defense in
// depth: assigning a string to obj.__proto__ is a no-op in V8, but we don't want
// these keys in the persisted map or the brain prompt regardless).
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function validSurfaceKey(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 256 && !FORBIDDEN_KEYS.has(id);
}

export function initOrders(path: string): void {
  filePath = path;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const perAgent: Record<string, string> = {};
    if (raw?.perAgent && typeof raw.perAgent === 'object') {
      for (const [k, v] of Object.entries(raw.perAgent)) {
        if (validSurfaceKey(k) && typeof v === 'string') perAgent[k] = v.slice(0, MAX_LEN);
      }
    }
    state = {
      global: typeof raw?.global === 'string' ? raw.global.slice(0, MAX_LEN) : '',
      perAgent,
    };
  } catch {
    /* first run / unreadable → defaults */
  }
}

export function getOrders(): OrdersState {
  return state;
}

export function setOrders(surfaceId: string | null, text: string): void {
  const t = String(text || '').slice(0, MAX_LEN);
  if (surfaceId === null) {
    state.global = t;
  } else {
    if (!validSurfaceKey(surfaceId)) return; // ignore bogus / dangerous keys
    if (t) state.perAgent[surfaceId] = t;
    else delete state.perAgent[surfaceId]; // empty per-agent directive = remove
  }
  persist();
}

/** Drop per-agent orders for surfaces no longer in the fleet (bounded growth). */
export function pruneOrders(liveIds: Set<string>): void {
  let changed = false;
  for (const id of Object.keys(state.perAgent)) {
    if (!liveIds.has(id)) {
      delete state.perAgent[id];
      changed = true;
    }
  }
  if (changed) persist();
}

/** The combined directive text for one agent — what the brain prompt receives. */
export function ordersFor(surfaceId: string): string {
  const parts = [];
  if (state.global.trim()) parts.push(state.global.trim());
  // typeof guard: if surfaceId happens to name an inherited prototype member
  // (e.g. "toString"), bracket access returns a function — `.trim()` on it would
  // throw inside onWaiting. Only treat an own string value as orders text.
  const per = state.perAgent[surfaceId];
  if (typeof per === 'string' && per.trim()) parts.push(per.trim());
  return parts.join('\n');
}

function persist(): void {
  if (!filePath) return;
  // fire-and-forget — orders are advisory state; a failed write must never
  // crash the engine, and the in-memory copy stays authoritative either way.
  mkdir(dirname(filePath), { recursive: true })
    .then(() => writeFile(filePath, JSON.stringify(state, null, 2), 'utf8'))
    .catch(() => {});
}
