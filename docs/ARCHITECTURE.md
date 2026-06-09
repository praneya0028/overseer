# Overseer — Architecture & Playbook

> A local, single-user "head-agent" control center for a fleet of cmux AI coding
> agents (Claude Code, Codex, Gemini, …). Type `overseer` in cmux → a browser pane
> opens showing every agent as a live tile; watch them, message them, stop them, and
> (optionally) let an AI "autopilot" answer the ones that stall. 100% local; never
> touches your code repos.

---

## 1. Tech stack

| Layer | Tech | Why |
|---|---|---|
| Daemon | **Node.js** (no framework) + `ws` | one tiny process; raw `http` + `ws` is enough |
| cmux link | **Unix domain socket**, newline-delimited JSON-RPC | persistent connection (see §5) |
| Autopilot brain | headless **`claude -p`** (model picked live: Opus 4.8 / Sonnet 4.6 / Haiku 4.5, or any via `OVERSEER_BRAIN_MODEL`) | decisions on your behalf |
| UI | **React 18 + Vite + TypeScript** | fast local dev, typed contract |
| Styling | **Tailwind** (CSS-var tokens) + **Framer Motion** | light/dark themes, GPU animations |
| State (client) | **Zustand** | flat store, cheap selective re-renders |
| Transport | **WebSocket** (`/ws`) + a tiny REST surface | server pushes, client acts |
| Build | `vite build` (client → `dist/client`) + `tsc` (server → `dist`, CommonJS) | single origin in prod |

Fonts self-hosted (`@fontsource`), no CDN. Server binds **`127.0.0.1` only**.

---

## 2. The three parts

```
            ┌─────────────────────────── your machine ───────────────────────────┐
            │                                                                      │
  cmux app ─┼─ control socket ──(persistent JSON-RPC)── Overseer DAEMON (Node)      │
  (agents)  │                                              │   │                   │
            │                                              │   └─ claude -p BRAIN  │
            │                                              │      (autopilot only) │
            │                              WebSocket /ws ──┤                       │
            │                                              ▼                       │
            │                                     React UI (cmux browser pane)     │
            └──────────────────────────────────────────────────────────────────────┘
```

1. **Daemon** (`src/server`) — the only thing that talks to cmux. Polls, derives
   state, runs autopilot, serves the SPA + WebSocket.
2. **Brain** (`src/server/brain.ts`) — a headless `claude -p` call; the *only*
   token-spending part, and only when autopilot is armed.
3. **UI** (`src/client`) — a thin viewer/controller over the WebSocket.

---

## 3. End-to-end flow

**Watching** (every heartbeat, ~1s):
```
daemon → cmux: system.top {all:true}        // topology + per-surface resources + claude PIDs
daemon → cmux: surface.read_text {id}        // each VISIBLE tile's screen (single-flight, budgeted)
daemon: derive state/model/mode/usage from the screen text  (pure, src/server/state.ts)
daemon → clients: {type:'agents', ...}       // over /ws
```

**Opening a terminal** (expanded view):
```
client → daemon: {subscribe, expandedId}
daemon → client: existing transcript instantly  +  pokeRead (fresh read)
daemon: fast loop reads ONLY that surface every 180ms → {type:'agentScreen'}
```

**Messaging an agent**:
```
client → daemon: {send, surfaceId, text}
daemon → cmux: surface.send_text {id, text}  // = typing it yourself; ZERO tokens
daemon: pokeRead → instant echo
```

**Autopilot** (only if armed for that agent OR global):
```
fleet detects a STABLE waiting state → emits 'waiting'
autopilot.onWaiting: dedupe + cooldown + rate-cap + single-flight checks
  → brain context: question + options + screen + SESSION HISTORY (the Fleet's
    committed scrollback, ~60 lines) + STANDING ORDERS (orders.ts) + PRECEDENT
    (decisionlog.precedents — same-cwd manual answers & accepted sends first)
  → brain (claude -p, picked model) decides {menu_choice | send_text | interrupt | defer_to_human}
    each with {confidence, risk: low|medium|high, reversible}
  → risk gates: high → defer, always · medium → needs reversible AND conf ≥ 0.9
    · low → conf ≥ 0.75 · interrupt always ≥ 0.9
  → safety: destructive regex guard, re-read-before-send
  → cmux.send_text / send_key   → agent continues
  → log the decision (cost, reasoning, risk) to the UI + .overseer/decisions.jsonl
```

---

## 4. Agent state machine (`src/server/state.ts`)

Pure function of the **viewport text + title glyph + agent type**. `deriveState(text,
title, agentType)` dispatches to a **per-vendor adapter**, because each TUI renders
its states differently:

- **`claude`** — the full machine below (permission boxes, numbered menus, composer).
- **`gemini`** — `Thinking…`/`esc to cancel` = working; the boxed `Answer Questions`
  menu (with ≥1 parsed option) = `waiting-question`; `Type your message` = idle.
  Menus are answered by **number hotkey** (the digit selects *and* submits).
- **`codex`** — `• Working`/`esc to interrupt` = working, else idle. Codex
  auto-approves and prints clarifying questions as plain text that returns to an idle
  prompt, so it is **never** classified `waiting-*` (we don't guess at an idle agent).
- **any other type** (`generic`/…) — watch-only: best-effort working/idle, **never**
  `waiting-*`. Only the Claude/Gemini adapters may emit a waiting state, so autopilot
  can never fire into a TUI we haven't reverse-engineered.

The Claude adapter, ordered, first-match-wins:

| State | How it's detected |
|---|---|
| `working` | braille spinner in title, or spinner/`esc to interrupt`/token-meter in the last lines |
| `error` | error/traceback patterns near the bottom |
| `waiting-permission` | a boxed `Do you want to…` prompt (no empty composer) |
| `waiting-question` | a numbered menu (≥2 options), **or** an idle agent whose last line is a question (the common "asked then waiting" case) |
| `done` | a finish marker + idle prompt |
| `idle` | bare empty `❯` composer or the status footer |
| `unknown` | nothing matched — rendered as idle in the UI, never autopiloted |

Key signal: an **empty composer** (`❯` with nothing after) = idle/ready, **not** a
menu — this separates "waiting on a menu" from "ready", and prevents stale
scrollback from faking prompts.

`model`, `mode` (auto/plan/accept-edits), and `usage` (5h/7d rate-limit %) are
parsed for free from the status footer.

---

## 5. cmux integration — hard-won facts

All verified live against cmux 0.64.x. **These are the load-bearing gotchas:**

- **Talk to the socket, NOT the CLI.** Each `cmux` CLI call spawns a 13 MB process
  and opens a fresh socket connection; under continuous polling the socket trips
  into refusing connections (`EPIPE` / "Broken pipe"). One **persistent** socket
  connection (newline JSON-RPC) is gentle and fast. `src/server/cmux.ts`.
- Wire format: `{"id":N,"method":"...","params":{...}}\n` → `{"result":...,"ok":true,"id":N}\n`.
- **Agent identity + type:** cmux's `coding_agents` registry lists every running
  agent **by type** (`claude`, `codex`, `gemini`, `generic`, …), each with its PIDs.
  Overseer builds a `pid → {id,label}` map from it, so a surface whose `resources.pids`
  (or `root_pids`/`tty_process_pids`) intersect the map is detected **and typed** in one
  step (`detectAgent`). Claude additionally has glyph (`✳`/braille/`✻`) + chrome
  (`auto mode` / `Opus … ctx`) fallbacks. `resume_binding` is **absent** from
  `system.top` (it IS in per-workspace `surface.list`, where `cwd` comes from).
- **Show every agent, including the launching session.** cmux injects
  `CMUX_SURFACE_ID` into every shell, so the old "exclude self" logic silently hid a
  real agent — it was removed. The Overseer UI is a browser pane, filtered out by
  `type !== 'terminal'`.
- **Socket path is auto-detected**, never hardcoded: `CMUX_SOCKET_PATH` → `cmux-<uid>.sock`
  → newest `cmux-*.sock`, re-resolved on every reconnect (survives a cmux restart).
- **Send** = `surface.send_text {surface_id, text}` (Claude `\n` submits); menus use
  `surface.send_key` (digit, or digit+Enter). Per-vendor — Gemini's digit auto-submits.
- **`read_text` returns only the ~60-line live viewport** — no scrollback (the
  `--scrollback` flag is a no-op in this build). Overseer builds its own deep
  scrollback with the **alignment engine** (`ingest`, poller.ts): each read is
  aligned against the previous live view to measure how far the window scrolled;
  exactly the scrolled-off prefix is committed to an append-only transcript
  (capped 3000 lines), and the still-mutating bottom is rendered live but never
  committed. Append-only history = no duplicates = no terminal flicker.
- **`system.top {all:true}`** is one call for topology + per-surface cpu/mem + the
  claude PID set — used as the heartbeat.

---

## 6. Reliability (why it "just works")

- **Self-healing socket:** keepalive ping every 12s; a request timeout destroys the
  socket so the next call reconnects fresh. No stuck "0 agents".
- **Fresh start every time:** `/health` exposes `cmuxReady` (a real `system.top` has
  landed AND the link is up — not the optimistic `cmuxOk`). The launcher reuses a
  daemon only when `cmuxReady`; a stale one (cmux died overnight) is restarted fresh,
  so you never open to an empty "No agents yet". A live-but-unlinked daemon gets a
  ~5s self-heal grace before any restart (cmux re-resolves its socket each reconnect).
- **One daemon, always:** launched **without a subshell** (a `( … )` wrapper broke the
  cmux socket connection) and by **absolute path** (so `pkill`/ownership patterns
  match). A duplicate hits `EADDRINUSE` → exits 0; `stop` blocks until the port frees
  (SIGTERM→SIGKILL) and only ever signals a pid confirmed to be our own daemon.
- **No tile flicker:** detection is *sticky* (a known agent + its type stay while its
  surface exists) + an 8s grace before removal; read blips never drop a tile.
- **Bounded polling / no infinite fetch:** single-flight per surface, a read budget
  per heartbeat, offscreen tiles paused, the expanded surface on its own 180ms loop,
  client WS reconnect backoff capped at 3s.
- **No memory leaks:** transcript capped (3000 lines), autopilot dedupe sets capped,
  `cwdCache` + client `fullScreens` + per-agent orders pruned to live agents, timers
  cleaned on stop. Screen frames are re-broadcast only when the rendered text
  actually changed (no idle 180ms re-render churn).

---

## 7. Token & cost model

- **Reading screens and sending text cost ZERO LLM tokens** — it's the cmux socket
  reading rendered text and injecting keystrokes, identical to using cmux yourself.
- The **only** token cost is the autopilot **brain** (`claude -p`), and only when an
  agent is armed *and* actually stalls. Hard-capped: **6 decisions / 60s** fleet-wide,
  **15s** per-agent cooldown, single-flight, dedupe — so it can't run away.
- True aggregate $-spend across Claude sessions is **not** exposed locally without
  API calls (which would cost tokens), so Overseer shows the free **rate-limit usage**
  (5h/7d %) instead, plus the autopilot's own spend.

---

## 8. Autopilot — guards (defense in depth)

`src/server/autopilot.ts`. Off by default (per-agent toggle + global; global ON
forces all, can't be bypassed per-agent; **Recall All** hard-disarms everything).

A decision is only **sent** if it passes: stable-waiting debounce → not already
answered (content hash) → cooldown → rate cap → single-flight → brain returns a
decision → **not** `defer_to_human` → **risk gates** (high → never; medium → needs
`reversible` + conf ≥ 0.9; low → conf ≥ 0.75; missing risk fields default
medium/irreversible, i.e. toward deferral) → **not** destructive (regex over
question + options + payload + on-screen action area) → screen re-read and
unchanged (vendor-aware) → menu index valid. Anything else routes to **Needs
You** for the human. The brain runs against the **selected model** (`getBrainModel()`);
the send is **per-vendor** (Claude: digit+Enter / text+`\n`; Gemini: single-digit
hotkey, deferred if the index is multi-digit). The whole gauntlet is vendor-neutral —
it guards Gemini exactly as it guards Claude.

**What makes the brain answer like the human** (not a generic LLM): standing
orders (`orders.ts` — global persisted to `.overseer/orders.json`, per-agent
session-scoped, both editable from the UI's ✎ orders buttons and treated as
overriding instructions in the prompt), session history (the Fleet's scrollback —
the brain infers the task before judging the question), and precedent
(`decisionlog.precedents` — the human's own `manual_answer`s rank first,
same-cwd first, so repeated answers become the brain's style).

---

## 9. Security

- Binds `127.0.0.1` only; WebSocket + mutating HTTP routes are **Origin-gated**
  (blocks cross-site WebSocket hijack / CSRF from any page you happen to visit).
- The test-only `/api/test/register` route is gated behind `OVERSEER_TEST=1`.
- No secrets logged; only autopilot decisions go to `.overseer/decisions.jsonl`.

---

## 10. File map

```
src/shared/contract.ts     # the frozen types shared by server + client
src/server/
  index.ts                 # http + ws + static + REST; wires Fleet ↔ Autopilot ↔ clients
  cmux.ts                  # persistent socket adapter (the ONLY cmux caller)
  poller.ts                # Fleet: heartbeat, reads, state, scrollback engine (ingest), flicker-grace
  state.ts                 # PURE state/model/mode/usage derivation
  autopilot.ts             # the head-agent engine + risk gates
  brain.ts                 # headless claude -p decision (orders + history + precedent prompt)
  orders.ts                # standing orders (global persisted, per-agent session)
  decisionlog.ts           # append-only JSONL + in-memory ring + precedent lookup
  types.ts                 # internal IFleet / IAutopilot interfaces
src/client/
  store.ts, ws.ts          # Zustand store + WebSocket client (auto-reconnect)
  components/               # TopBar, FleetGrid, AgentTile, AgentExpanded (tagged
                            #   conversation + deep scrollback), OrdersEditor,
                            #   CommandBar, RightRail, CommandPalette, Avatar, Logo, Toaster
  lib/                      # identity (callsign/hue), state-ui (colors/format), state-color
bin/overseer.sh             # launcher: ensure daemon + open/focus console; `stop|status`
docs/ARCHITECTURE.md       # this file
```

## 11. Run / control

```
overseer            # ensure daemon up + open the console (after the ~/.zshrc one-liner)
overseer stop       # shut the daemon down + close the console tab
overseer status     # health
npm run dev        # Vite HMR on :5173 proxying /api + /ws to the daemon on :7878
```

Env: `OVERSEER_PORT` (7878) · `OVERSEER_BRAIN_MODEL` (startup brain model, default
`claude-opus-4-8`; any id works and joins the dropdown) · `OVERSEER_SHADOW=1`
(decide+log but never send) · `CMUX_SOCKET_PATH` (auto-detected if unset) ·
`OVERSEER_TEST=1` (enables the test-only register route).
