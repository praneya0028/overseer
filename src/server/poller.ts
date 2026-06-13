// ============================================================================
// poller.ts — the Fleet: the single owner of all cmux polling. Heartbeats
// system.top (topology + per-surface resources), reads viewports with
// single-flight + adaptive cadence + offscreen pausing, derives state, debounces
// "stable waiting", and emits 'agents' / 'screen' / 'cmux' / 'waiting'.
// This is where the "no infinite-fetching" guarantee lives.
// ============================================================================

import { EventEmitter } from 'node:events';
import { Agent } from '../shared/contract';
import { IFleet } from './types';
import * as cmux from './cmux';
import { RawSurface } from './cmux';
import { deriveState, detectAgent, detectAgentByPid, splitGlyph, screenHash, stripComposerBox, AgentKind } from './state';

// Over the persistent socket cmux handles bursts fine, so poll responsively.
// A read budget still bounds per-tick work for very large fleets.
const HEARTBEAT_MS = 1000; // system.top cadence
const EXPANDED_MS = 180; // dedicated fast poll for the one expanded surface (near-instant)
const READ_BUDGET = 10; // max read_text calls per heartbeat
const CADENCE = {
  expanded: 400,
  visibleWorking: 800,
  visibleOther: 1500,
};
const STABLE_K = 3; // unchanged hashes before "waiting" is published
// Re-emit 'waiting' for a still-stalled screen on this cadence (not just once per
// hash). The autopilot's own answered-set / cooldown / rate-cap / single-flight
// guards dedupe and throttle the brain; this re-poke is what lets a TRANSIENT
// failure (brain_error/timeout/rate_capped) retry, and a SECOND distinct question
// that first arrived inside the 15s cooldown get picked up once it expires.
const WAITING_REEMIT_MS = 5000;
const GONE_GRACE_MS = 8000; // a tile only disappears after its surface is gone this long (no flicker)
const CWD_TTL_MS = 30_000;
const TILE_LINES = 6;

interface Meta {
  nextReadAt: number;
  reading: boolean;
  failCount: number;
  lastHash: string;
  stableCount: number;
  lastWaitingHash: string; // last hash we emitted 'waiting' for (dedupe)
  lastWaitingEmitAt: number; // when we last emitted 'waiting' (for re-poke)
  fullText: string;
  workingSince?: number;
  lastSeen: number; // last tick this surface was present in the tree
  transcript: string[]; // committed scrollback: ONLY lines that scrolled off the viewport
  liveView: string[]; // the current (still-mutating) viewport — never committed while visible
  lastScreenSent: string; // last display text broadcast — skip identical re-emits
}

const TRANSCRIPT_MAX = 3000; // bounded history — deep scrollback, never grows without limit

// Volatile / chrome lines that should NOT enter the rolling transcript (they
// change every tick and would create churn/duplication).
function isVolatileLine(l: string): boolean {
  const t = l.trim();
  if (!t) return true;
  if (/^[─—=_~·•+|\s-]+$/.test(t)) return true; // pure rule
  if (/^((Opus|Sonnet|Haiku|Fable)\s+[\d.]|claude-[\w.[\]-]+\s*\|)/i.test(t)) return true; // status footer (friendly name or raw model id)
  if (/⏵⏵\s*auto mode|shift\+tab to cycle|← for agents|esc to interrupt/i.test(t)) return true;
  if (/^❯\s*$/.test(t)) return true; // empty composer
  // Spinner/thinking timer — Claude cycles through MANY spinner glyphs (✻ ✽ ✢ ✳ …),
  // so match ANY leading symbol; the gerund + timer-paren is the real signature.
  if (/^[^\w\s]\s+\w+(?:ing|ed|…).*(?:\bfor\b\s*\d+s|\(\s*\d+m?\s?\d*s)/i.test(t)) return true;
  // a "mostly rule" pane-title separator like "──── name ────"
  const ruleChars = (t.match(/[─-╿▀-▟=_~·•+|-]/g) || []).length;
  return t.length >= 8 && ruleChars / t.length >= 0.6;
}

// Strip + filter a raw viewport read into displayable scrollback lines.
function viewLines(text: string): string[] {
  return stripComposerBox(text)
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .filter((l) => !isVolatileLine(l));
}

// Scrollback engine. The viewport is a 60-line window over a stream: lines that
// scroll off its TOP are final; lines near the bottom may still be mutating
// (streamed output rewrites in place every tick). So on each read we ALIGN the
// previous live view against the new one to measure how far the window scrolled,
// commit exactly the scrolled-off prefix to the transcript, and replace the live
// view wholesale. Committed history is append-only → no duplicates, no churn —
// which is also what keeps the expanded terminal from flickering/jumping.
export function ingest(m: { transcript: string[]; liveView: string[] }, text: string): void {
  const V = viewLines(text);
  if (!V.length) return; // blank/mid-redraw frame — keep what we have
  const P = m.liveView;
  if (P.length) {
    // Anchored alignment: for each candidate scroll amount s, count consecutive
    // matching lines from the top of the overlap (trailing mismatches are fine —
    // that's the still-streaming bottom). Accept a 2+ line run, or a run that
    // covers the WHOLE overlap window (a big scroll leaves only a sliver of
    // overlap). Best run wins; ties → smallest s, so we never over-commit.
    // No acceptable run at any s means a full TUI redraw.
    let bestS = -1;
    let bestLen = 0;
    let bestFull = false;
    for (let s = 0; s < P.length; s++) {
      const span = Math.min(P.length - s, V.length);
      let len = 0;
      while (len < span && P[s + len] === V[len]) len++;
      const full = len === span && span >= 1;
      // Strictly-greater only, so on ties the SMALLEST s wins — i.e. we commit
      // the FEWEST scrolled-off lines. (A run of identical lines like `}`/`}`
      // otherwise lets a larger-s "full" alignment win and commit a spurious
      // duplicate even though only the bottom line mutated.)
      if (len > bestLen) {
        bestLen = len;
        bestS = s;
        bestFull = full;
      }
      if (full && span >= 2) break; // perfect alignment — can't beat it
    }
    const aligned = bestLen >= 2 || (bestFull && bestLen >= 1);
    if (!aligned && V.length >= 2) {
      // The new view shows content we ALREADY have rather than new output —
      // either a full-screen overlay (help / transcript view) just closed and
      // restored what was underneath, OR the user scrolled the pager back UP.
      // Find V as a contiguous block of the full display (committed + live).
      const full = m.transcript.length ? [...m.transcript, ...m.liveView] : m.liveView;
      const at = lastBlockIndex(full, V, V.length + 120);
      if (at >= 0) {
        if (at + V.length === m.transcript.length) {
          // V is the block that sits at the LIVE EDGE of committed history (its
          // last line is the last committed line) → an overlay closed and
          // restored exactly what was underneath → un-commit back to the match so
          // it isn't re-committed when it next scrolls off (this also drops the
          // overlay's own chrome). The adjacency check is essential: matching ANY
          // buried block (at + V.length < transcript.length) would truncate away
          // — and permanently lose — every line committed after it.
          m.transcript.length = at;
          m.liveView = V;
          return;
        }
        if (at + V.length > m.transcript.length) {
          // V spans into / sits within the LIVE region → backward scroll showing
          // content still on screen. Leave the transcript AND the real live tail
          // untouched — committing P or adopting V here would duplicate history
          // the moment the user scrolls back down.
          return;
        }
        // else: V matches only a BURIED historical block (not the live edge, not
        // the live region). This is a genuine redraw that happens to coincide with
        // old content — fall through and commit P as history; never truncate.
      }
    }
    // Aligned: commit the lines that scrolled off the top. Unaligned (redraw /
    // clear): the old view is gone from screen — commit it as history. Either
    // way, trim the prefix that already ends the transcript (idempotent on
    // repeated identical redraw frames).
    let commit = aligned ? P.slice(0, bestS) : P;
    commit = commit.slice(overlapWithTail(m.transcript, commit));
    if (commit.length) {
      m.transcript.push(...commit);
      if (m.transcript.length > TRANSCRIPT_MAX) m.transcript.splice(0, m.transcript.length - TRANSCRIPT_MAX);
    }
  }
  m.liveView = V;
}

// Last start index where B appears as a contiguous block in T, provided the
// match ends within the trailing `window` lines (recent history only). -1 if none.
function lastBlockIndex(T: string[], B: string[], window: number): number {
  const minEnd = Math.max(0, T.length - window);
  for (let i = T.length - B.length; i >= 0; i--) {
    if (i + B.length < minEnd) break;
    let ok = true;
    for (let j = 0; j < B.length; j++) {
      if (T[i + j] !== B[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

// Longest k such that T's last k lines equal B's first k lines (suffix-prefix
// overlap). Used to drop the already-committed head of a commit block.
function overlapWithTail(T: string[], B: string[]): number {
  for (let k = Math.min(T.length, B.length); k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (T[T.length - k + i] !== B[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return k;
  }
  return 0;
}

// Full display text for a surface: committed scrollback + the live viewport.
function displayText(m: Meta): string {
  return [...m.transcript, ...m.liveView].join('\n');
}

export class Fleet extends EventEmitter implements IFleet {
  private agents = new Map<string, Agent>();
  private meta = new Map<string, Meta>();
  private cwdCache = new Map<string, { cwd?: string; at: number }>();
  private testAgents = new Set<string>();
  private visible = new Set<string>();
  private expandedId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private fastTimer: NodeJS.Timeout | null = null;
  private fastReading = false;
  private cmuxOk = true;
  private polledOnce = false; // has ≥1 system.top actually succeeded? (cmuxOk is optimistic)
  private topFails = 0;

  /** True only once we hold REAL cmux data AND the link is currently up. The
   *  launcher waits on this before opening the UI, so it never opens blank. */
  cmuxReady(): boolean {
    return this.cmuxOk && this.polledOnce;
  }
  private stopped = false;

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const tick = async () => {
      await this.heartbeat().catch((e) => {
        if (process.env.OVERSEER_DEBUG) console.error('[hb] ERROR', e?.stack || e);
      });
      if (!this.stopped) this.timer = setTimeout(tick, HEARTBEAT_MS);
    };
    tick();
    // Dedicated fast loop: keep the ONE expanded surface live (~instant) without
    // hammering the whole fleet. cmux read_text is free (no LLM tokens).
    const fast = async () => {
      await this.fastPoll().catch(() => {});
      if (!this.stopped) this.fastTimer = setTimeout(fast, EXPANDED_MS);
    };
    fast();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.fastTimer) clearTimeout(this.fastTimer);
    this.timer = null;
    this.fastTimer = null;
    cmux.close();
  }

  /** Read the expanded surface immediately and push it (called after a send). */
  async pokeRead(id: string): Promise<void> {
    if (this.expandedId !== id) return;
    await this.fastPoll().catch(() => {});
  }

  // Fast path: read only the expanded surface and emit its screen live.
  private async fastPoll(): Promise<void> {
    const id = this.expandedId;
    if (!id || this.fastReading) return;
    const m = this.meta.get(id);
    if (!m) return;
    this.fastReading = true;
    try {
      const r = await cmux.readText(id);
      m.fullText = r.text;
      m.failCount = 0;
      ingest(m, r.text);
      // Only broadcast when the rendered text actually changed — the fast loop
      // ticks every ~180ms, and pushing identical frames makes the client
      // re-render (and the terminal visibly shimmer) for nothing.
      const d = displayText(m);
      if (d !== m.lastScreenSent) {
        m.lastScreenSent = d;
        this.emit('screen', { id, fullText: d });
      }
    } catch {
      /* heartbeat handles persistent failures */
    } finally {
      this.fastReading = false;
    }
  }

  getAgents(): Agent[] {
    return [...this.agents.values()];
  }
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }
  getFullScreen(id: string): string | undefined {
    const m = this.meta.get(id);
    return m ? displayText(m) || m.fullText : undefined;
  }
  setView(visibleIds: string[], expandedId: string | null): void {
    this.visible = new Set(visibleIds);
    this.expandedId = expandedId;
  }
  registerTestAgent(surfaceId: string): void {
    this.testAgents.add(surfaceId);
  }

  // ---- heartbeat ----
  private async heartbeat(): Promise<void> {
    if (process.env.OVERSEER_DEBUG) console.error('[hb] start');
    let top: cmux.RawTop;
    try {
      top = await cmux.systemTop();
      this.topFails = 0;
      this.polledOnce = true; // we now have REAL cmux data, not the optimistic default
      if (!this.cmuxOk) {
        this.cmuxOk = true;
        this.emit('cmux', true);
      }
    } catch (e: any) {
      this.topFails++;
      if (process.env.OVERSEER_DEBUG) console.error('[hb] system.top failed:', e?.message);
      // Tolerate brief blips; only declare cmux down after several in a row, and
      // keep serving the last-known fleet meanwhile (don't blank the UI).
      if (this.cmuxOk && this.topFails >= 3) {
        this.cmuxOk = false;
        this.emit('cmux', false, e?.message || 'cmux unreachable');
      }
      return;
    }

    // Map every running coding-agent PID → its kind. cmux's `coding_agents`
    // registry tags agents by type (claude / codex / generic / …), so this both
    // detects an agent AND names its kind — agent-agnostic, not Claude-only.
    const agentByPid = new Map<number, AgentKind>();
    for (const ca of top.coding_agents || []) {
      // Never let a missing/blank cmux id become a falsy agent kind — a falsy
      // kind would fall through to the Claude state parser (which CAN emit
      // waiting-*), letting autopilot fire on an unverified TUI. Default to the
      // watch-only 'generic' adapter instead.
      const kind: AgentKind = { id: ca.id || 'generic', label: ca.display_name || ca.id || 'agent' };
      for (const p of ca.resources?.pids || []) agentByPid.set(p, kind);
    }

    // Flatten surfaces with their window/workspace context.
    const seen = new Set<string>();
    const now = Date.now();
    interface Cand {
      s: RawSurface;
      windowId: string;
      wsId: string;
      kind: AgentKind;
    }
    const cands: Cand[] = [];

    const existing = new Set<string>(); // every terminal surface present this tick
    for (const w of top.windows || []) {
      for (const ws of w.workspaces || []) {
        for (const pane of ws.panes || []) {
          for (const s of pane.surfaces || []) {
            if (s.type === 'terminal') existing.add(s.id);
            // Show EVERY cmux terminal agent — including the session you launched
            // from. cmux injects CMUX_SURFACE_ID into every shell, so excluding
            // "self" silently hid a real agent (the #1 "No agents yet" complaint).
            // The Overseer UI is a browser pane, already filtered by type above.
            const prevText = this.meta.get(s.id)?.fullText;
            // Kind resolution, strongest signal first:
            //   1. PID match via the foreground (tty) process group — a terminal can
            //      hold SEVERAL agent kinds (a suspended codex behind a live Claude),
            //      and the foreground process is the one the human is talking to.
            //      This also lets a surface re-tag correctly when the user switches
            //      vendors in the same tab.
            //   2. STICKY previous kind — cmux's PID set fluctuates tick to tick, so
            //      on a PID-miss tick the already-resolved kind holds (no flapping,
            //      and the glyph/chrome fallback can't re-tag a known codex/gemini
            //      surface as 'claude').
            //   3. Full detection incl. the Claude glyph/chrome fallback (new agents).
            const prevA = this.agents.get(s.id);
            let kind: AgentKind | null = detectAgentByPid(s, agentByPid);
            if (!kind && prevA) kind = { id: prevA.agentType, label: prevA.agentLabel };
            if (!kind) kind = detectAgent(s, prevText, agentByPid);
            if (!kind && this.testAgents.has(s.id)) kind = { id: 'claude', label: 'Claude Code' };
            if (!kind) continue;
            seen.add(s.id);
            const m = this.metaFor(s.id);
            m.lastSeen = now;
            cands.push({ s, windowId: w.id, wsId: ws.id, kind });
          }
        }
      }
    }

    // Drop a tile ONLY after its surface has been truly gone for a grace period
    // (handles a momentary tree-read glitch without flicker).
    for (const id of [...this.agents.keys()]) {
      if (existing.has(id)) {
        const m = this.meta.get(id);
        if (m) m.lastSeen = now;
        continue;
      }
      const m = this.meta.get(id);
      if (!m || now - m.lastSeen > GONE_GRACE_MS) {
        this.agents.delete(id);
        this.meta.delete(id);
      }
    }
    // Prune cwd cache for surfaces that no longer exist (bounded growth).
    for (const sid of [...this.cwdCache.keys()]) if (!existing.has(sid)) this.cwdCache.delete(sid);

    // Read priority: expanded tile first, then the most-overdue visible tiles.
    // A per-heartbeat read budget bounds how many cmux processes we spawn — the
    // socket breaks if we read every tile every tick.
    cands.sort((a, b) => this.readScore(a.s.id, now) - this.readScore(b.s.id, now));
    let budget = READ_BUDGET;
    const grant = () => (budget > 0 ? (budget--, true) : false);

    // Process serially (cmux is serialized anyway) so the budget is honoured.
    for (const c of cands) {
      await this.updateSurface(c.s, c.windowId, c.wsId, c.kind, now, grant);
    }
    if (process.env.OVERSEER_DEBUG) console.error('[hb] done, agents=', this.agents.size, 'budgetLeft=', budget);
    this.emit('agents', this.getAgents());
  }

  private readScore(id: string, now: number): number {
    if (this.expandedId === id) return -1; // always first
    const next = this.meta.get(id)?.nextReadAt ?? 0;
    return now >= next ? next : Number.MAX_SAFE_INTEGER; // due ones first, oldest-due wins
  }

  private metaFor(id: string): Meta {
    let m = this.meta.get(id);
    if (!m) {
      m = { nextReadAt: 0, reading: false, failCount: 0, lastHash: '', stableCount: 0, lastWaitingHash: '', lastWaitingEmitAt: 0, fullText: '', lastSeen: Date.now(), transcript: [], liveView: [], lastScreenSent: '' };
      this.meta.set(id, m);
    }
    return m;
  }

  private cadenceFor(id: string, working: boolean): number {
    if (this.expandedId === id) return CADENCE.expanded;
    return working ? CADENCE.visibleWorking : CADENCE.visibleOther;
  }

  private async getCwd(surfaceId: string, workspaceId: string): Promise<string | undefined> {
    // Cache keyed by SURFACE, not workspace: cwd is resolved per-surface, and a
    // workspace can hold several surfaces with different cwds. Keying by workspace
    // let the first surface's cwd be served to every sibling for the TTL — and a
    // wrong cwd feeds the autopilot brain prompt.
    const hit = this.cwdCache.get(surfaceId);
    if (hit && Date.now() - hit.at < CWD_TTL_MS) return hit.cwd;
    try {
      const list = await cmux.surfaceListForWorkspace(workspaceId);
      for (const item of list) {
        const cwd = item.requested_working_directory || item.resume_binding?.cwd || undefined;
        if (item.id === surfaceId && cwd) {
          this.cwdCache.set(surfaceId, { cwd, at: Date.now() });
          return cwd;
        }
      }
      // This surface wasn't in the list — best-effort fall back to the workspace's
      // first known cwd, cached under THIS surface's id (never poisoning siblings).
      const any = list.find((i) => i.requested_working_directory)?.requested_working_directory || undefined;
      this.cwdCache.set(surfaceId, { cwd: any, at: Date.now() });
      return any;
    } catch {
      return this.agents.get(surfaceId)?.cwd;
    }
  }

  private async updateSurface(
    s: RawSurface,
    windowId: string,
    workspaceId: string,
    kind: AgentKind,
    now: number,
    grant: () => boolean,
  ): Promise<void> {
    const m = this.metaFor(s.id);
    const prev = this.agents.get(s.id);
    const { glyph, name } = splitGlyph(s.title || '');

    // Decide whether to read this surface's viewport this tick.
    // Paused (offscreen, not expanded) tiles skip the read but stay immediately
    // due, so they refresh the instant they scroll back into view.
    // The expanded surface is read by the dedicated fast loop, not here.
    const isExpanded = this.expandedId === s.id;
    const paused = !this.visible.has(s.id) && !isExpanded;
    const due = now >= m.nextReadAt && !m.reading;
    let didRead = false;

    if (isExpanded) {
      // fast loop owns reads; just rebuild the agent from its latest text
    } else if (paused) {
      m.nextReadAt = 0; // read immediately once it returns to view
    } else if (due && grant()) {
      m.reading = true;
      try {
        const r = await cmux.readText(s.id);
        m.failCount = 0;
        m.fullText = r.text;
        ingest(m, r.text);
        didRead = true;
      } catch {
        // A failed read keeps the last text (removal is owned by the
        // surface-existence + grace check). Back off so a wedged surface doesn't
        // stay perpetually "due" and starve the read budget ahead of healthy tiles.
        m.failCount++;
        m.nextReadAt = now + Math.min(CADENCE.visibleOther * (m.failCount + 1), 10_000);
      } finally {
        m.reading = false;
      }
    }

    const text = m.fullText;
    const derived = deriveState(text, s.title || '', kind.id);
    if (process.env.OVERSEER_DEBUG && this.testAgents.has(s.id)) {
      console.error(`[test] ${s.ref} paused=${paused} due=${due} read=${didRead} len=${text.length} state=${derived.state} opts=${derived.options?.length || 0}`);
    }
    // Advance the next-read time ONLY after an actual read (else we'd starve it).
    if (didRead) m.nextReadAt = now + this.cadenceFor(s.id, derived.state === 'working');

    // Debounce → stable waiting publication.
    const h = screenHash(text);
    if (h === m.lastHash) m.stableCount++;
    else {
      m.lastHash = h;
      m.stableCount = 0;
    }

    // working elapsed timer
    if (derived.state === 'working') {
      if (!m.workingSince) m.workingSince = now;
    } else {
      m.workingSince = undefined;
    }

    const cwd = await this.getCwd(s.id, workspaceId);
    // Strip the live input composer for DISPLAY (not for deriveState, which needs
    // the composer/footer) so a half-typed draft never renders as a sent message.
    const lines = stripComposerBox(text)
      .split('\n')
      .map((l) => l.replace(/\s+$/g, ''));
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const viewportLines = lines.slice(-TILE_LINES);

    const agent: Agent = {
      id: s.id,
      surfaceRef: s.ref,
      windowId,
      workspaceId,
      title: s.title || '',
      name: name || s.ref,
      glyph,
      agentType: kind.id,
      agentLabel: kind.label,
      cwd,
      model: derived.model,
      mode: derived.mode,
      usage: derived.usage,
      state: derived.state,
      autopilotEnabled: prev?.autopilotEnabled ?? false,
      autopilot: prev?.autopilot ?? 'off',
      needsInput: derived.state === 'waiting-permission' || derived.state === 'waiting-question',
      question: derived.question,
      options: derived.options,
      viewportLines,
      telemetry: {
        elapsedWorkingMs: m.workingSince ? now - m.workingSince : undefined,
        cpuPercent: s.resources?.cpu_percent,
        memBytes: s.resources?.memory_bytes,
        ctxPct: derived.ctxPct,
        processCount: s.resources?.process_count,
      },
      lastUpdated: now,
      isTestAgent: this.testAgents.has(s.id) || undefined,
    };
    this.agents.set(s.id, agent);

    // (The expanded surface's 'screen' is emitted by the dedicated fast loop,
    // not here — avoids a duplicate broadcast every heartbeat.)

    // Publish a stable waiting agent. We emit on a NEW distinct waiting screen,
    // and then RE-EMIT on a slow cadence while it stays stalled — the autopilot
    // needs the re-poke to retry a transient failure or to pick up a second
    // question that first landed inside its per-agent cooldown. (Its answered-set
    // + cooldown + rate-cap + single-flight guards keep this from re-asking a
    // screen it already resolved.)
    const waiting = derived.state === 'waiting-permission' || derived.state === 'waiting-question';
    if (waiting && m.stableCount >= STABLE_K) {
      const isNewScreen = m.lastWaitingHash !== h;
      if (isNewScreen || now - m.lastWaitingEmitAt >= WAITING_REEMIT_MS) {
        m.lastWaitingHash = h;
        m.lastWaitingEmitAt = now;
        this.emit('waiting', agent);
      }
    } else if (!waiting) {
      // Left the waiting state — reset so the same screen re-arms if it returns.
      m.lastWaitingHash = '';
      m.lastWaitingEmitAt = 0;
    }
  }
}
