<div align="center">

![Overseer — Control Center for your AI agent fleet](docs/banner.svg)

# ☉ Overseer

### One screen to **watch, command, and auto-pilot** your fleet of AI coding agents.

[![status](https://img.shields.io/badge/status-ship--ready-2dd4bf?style=for-the-badge)](#status)
[![local only](https://img.shields.io/badge/100%25-local-22d3ee?style=for-the-badge)](#privacy--safety)
[![watching = zero tokens](https://img.shields.io/badge/watching%20%26%20commanding-zero%20tokens-7a4fd0?style=for-the-badge)](#does-it-cost-tokens)
[![license](https://img.shields.io/badge/license-MIT-f5b83d?style=for-the-badge)](LICENSE)

*A control deck for [cmux](https://cmux.com). Type `overseer`, and every agent in your terminal becomes a
live tile you can watch, message, or hand to an AI that answers the judgment-call questions your auto
modes stop on.*

<br/>

<img src="docs/screenshots/dashboard-light.png" alt="Overseer dashboard — a live mixed fleet of Claude, Codex and Gemini agents, with Needs You and an Autopilot Log" width="100%">

<sub>A live mixed fleet in one view — each agent tagged by type. Anything the brain shouldn't decide alone lands in **Needs You**; every call it makes is logged with its risk, cost, and reasoning.</sub>

</div>

---

## What it is

You're running a few coding agents at once — Claude in one cmux tab, Codex in another, Gemini in a third,
all on auto. Auto mode approves their tool calls and recovers from blocks, but it can't clear **one** kind
of pause: when an agent stops to ask *you* a real question (*"two valid migration paths — which did you
mean?"*). An auto mode can make an agent ask *less*, but when it does ask, nothing answers for it — so the
fleet stalls and you tab-hop to babysit.

Overseer is two things:

- **One control surface for the whole fleet** — every agent as a live tile (state, model, context %,
  elapsed), a fleet-wide **Needs You** queue and **Autopilot Log**, and click-into / message / stop *any*
  agent without switching tabs. Each terminal keeps a deep, flicker-free scrollback even though cmux only
  exposes a ~60-line window. This part costs **zero AI tokens** — it's the same terminal I/O as reading the
  screen yourself.
- **A head-agent "autopilot"** — when an armed agent stalls on a real on-screen question or permission, a
  small headless `claude -p` brain reads it, decides the safe answer, and sends it for you — and bounces
  anything destructive, ambiguous, or low-confidence back to you. Off by default, hard-capped, fully
  audited. It answers like *you*: it reads the agent's session history, your standing orders
  (*"prefer npm", "never touch staging"*), and precedent — how you answered similar questions before.

Plenty of tools give you a multi-agent dashboard. The part I cared about is the second half: a brain that
answers an agent's *own* on-screen question, across a mixed fleet, the way I would.

| When an agent… | Auto mode | **Overseer autopilot** |
|---|---|---|
| wants a pre-allowed tool / permission | ✅ approves it | leaves it alone |
| hits a **denied** action it can route around | ✅ recovers | leaves it alone |
| **asks a judgment question** ("which approach?") | ⏸️ stops | 🛸 reads it + context, answers the safe ones |
| **finishes by asking a question** | ⏸️ stops at the prompt | 🔔 surfaces it in **Needs You** |
| hits something **destructive / ambiguous / low-confidence** | n/a | 🛑 always routes to you |

---

## A look

<div align="center">

<img src="docs/screenshots/terminal.png" alt="An agent's live terminal — your prompt tagged You, its work below, with a composer" width="94%">

<sub>**Click any tile → the agent's live terminal.** Your prompts tagged **You →**, work flowing below like a conversation, a composer to reply. Deep scrollback; **↓ latest** snaps back to the live tail; only the newest line re-renders while streaming.</sub>

<br/><br/>

<img src="docs/screenshots/orders.png" alt="Standing orders — your written directive the autopilot brain obeys" width="94%">

<sub>**Standing orders** — write a directive once (fleet-wide or per-agent) and the brain follows it. Beside it, the **brain-model dropdown**: Opus 4.8 / Sonnet 4.6 / Haiku 4.5, or any Claude model id.</sub>

<br/><br/>

<img src="docs/screenshots/dashboard-dark.png" alt="Overseer dashboard in dark theme — the same mixed fleet, Needs You, Autopilot Log" width="94%">

<sub>Dark theme — the **Autopilot Log** records every decision (cost + reasoning); waiting agents surface in **Needs You**. Light or dark, remembered across sessions.</sub>

</div>

---

## Autopilot

Off by default, armed per-agent or fleet-wide, and the only part that ever spends a token. When an agent
reaches a stable waiting state, the brain gets the question + screen, the agent's session history, your
standing orders, and precedent (your past answers, same project first). Pick its model live — Opus 4.8
(default) / Sonnet 4.6 / Haiku 4.5. It returns one of four decisions, each with a risk and reversibility
call the server enforces:

| Decision | Meaning |
|---|---|
| `menu_choice` | pick a numbered option from the agent's menu |
| `send_text` | type a free-form answer and submit it |
| `interrupt` | `Ctrl-C` the agent — only at self-reported confidence ≥ 0.9 |
| `defer_to_human` | "I shouldn't decide this" → routes to **Needs You** |

It's tuned to be useful, not just cautious: low-risk reversible routine gets answered; medium-risk needs
≥ 0.9 confidence *and* reversibility; **high-risk / irreversible never auto-sends.** Before anything is
sent it runs a gauntlet — dedupe, 15s per-agent cooldown, fleet cap (6/60s), single-flight, the risk
gates, a destructive deny-list over the concrete act (delete / `rm` / `sudo` / deploy / production /
secrets / payments / `curl … | sh` …), then a final screen re-read so a moved prompt aborts instead of
firing stale. Anything that fails lands in **Needs You**.

Every decision (sent, deferred, bounced, or your own answer) is logged with cost, latency, reasoning, and
the exact action — in the **Autopilot Log** and `.overseer/decisions.jsonl` (local, gitignored).
Hold-to-confirm **Recall All** disarms the whole fleet and aborts anything in flight.

> Try it send-free: `OVERSEER_SHADOW=1` makes autopilot decide + log what it *would* do on every stall,
> without arming anything. Watch it reason for a day before you arm it.

---

## How it works

The daemon holds one persistent socket to cmux. Every second it lists agents and reads each visible
terminal, deriving state as a pure function of the screen (`src/server/state.ts` — the key signal is the
empty `❯` composer, which tells a real pending prompt from stale scrollback; an `unknown` agent is never
autopiloted). The UI renders the fleet over a WebSocket; messaging an agent types into its terminal —
zero tokens. Only an armed autopilot call spends one. Full design notes, file map, and the hard-won cmux
gotchas live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Agent-agnostic:** detection rides on cmux's own coding-agent registry, so Overseer shows every agent as
a tile. Each has a small per-vendor adapter — **Claude** (full: detect, parse, answer menus by number +
Enter), **Gemini** (answers the boxed `Answer Questions` menu by its number — Overseer sends the digit without a trailing Enter), **Codex**
(watch-only — it prints clarifying questions as plain text indistinguishable from "done", so Overseer
never auto-answers those). Only adapters whose TUI has actually been worked out may emit a waiting state,
so autopilot can't fire into a terminal nobody reverse-engineered.

---

## Does it cost tokens?

- **Watching & messaging: no.** Reading screens and typing text is pure terminal I/O over cmux's socket —
  it never calls an LLM. Leave it open all day; it costs nothing.
- **Autopilot: yes**, on your normal Claude plan — one rate-capped `claude -p` call, only when you've armed
  it *and* an agent stalls. Every call's cost shows in the log; use a cheaper brain model or
  `OVERSEER_SHADOW=1` to log without sending.

---

## Quick start

> **Requires:** macOS with [cmux](https://cmux.com), Node 18+, and `python3` (ships with the macOS Command
> Line Tools — the launcher uses it to open/focus the console pane). The `claude` CLI is only needed for
> the optional autopilot, at `~/.local/bin/claude` (default) or wherever you point `CLAUDE_BIN`.

```bash
git clone https://github.com/praneya0028/overseer ~/Code/overseer
cd ~/Code/overseer
npm install
npm run build

# add to ~/.zshrc so you can launch it from any cmux tab:
echo 'overseer() { ~/Code/overseer/bin/overseer.sh "$@"; }' >> ~/.zshrc
source ~/.zshrc
```

Then, from any cmux terminal:

```bash
overseer          # ensure the daemon is up + open the control center
overseer stop     # shut it down
overseer status   # health check
```

Every cmux agent shows up automatically, including the session you launched from. Running `overseer` again
is safe — a stale daemon is restarted fresh.

### Config (all optional)

| env var | default | what |
|---|---|---|
| `OVERSEER_PORT` | `7878` | local port (binds `127.0.0.1` only) |
| `OVERSEER_BRAIN_MODEL` | `claude-opus-4-8` | startup brain model; switch live, or type any Claude model id |
| `CLAUDE_BIN` | `~/.local/bin/claude` | path to the `claude` CLI the brain calls |
| `OVERSEER_SHADOW` | `0` | `1` = decide + log but never send |
| `CMUX_SOCKET_PATH` | auto | cmux control socket; auto-detected if unset |

---

## Privacy & safety

- **100% local.** Binds `127.0.0.1` only. Nothing uploaded; no telemetry.
- **Never touches your repos** — only reads/controls cmux sessions over the local socket.
- **Origin-gated** WebSocket + mutating routes (blocks a web page you visit from reaching the daemon). The
  test-only route is gated behind `OVERSEER_TEST=1`.
- **`execFile`, never a shell** for the brain call; static serving strips `../`.
- **Autopilot rails:** off by default; never sends destructive / ambiguous / low-confidence; re-reads the
  screen right before sending; hold-to-confirm **Recall All**.
- Everything on disk stays under `.overseer/` (gitignored). No secrets logged. To report a vulnerability,
  see [`SECURITY.md`](SECURITY.md).

---

## Tech & status

Node (raw `http` + `ws`) · React 18 + Vite + TypeScript · Tailwind · Framer Motion · Zustand · persistent
Unix-socket JSON-RPC to cmux · headless `claude -p` for autopilot. No database, no cloud, self-hosted
fonts. `npm test` runs the scrollback-engine and safety-gate unit tests.

<a id="status"></a>**Status:** in daily use as a local single-user tool, verified against cmux 0.64.x. macOS + cmux today; the
daemon is plain Node, so other platforms are a small lift.

## Contributing

Issues and PRs welcome — especially cmux compatibility, more agent adapters, and platform support. Start
with [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Licensed **MIT**.
</content>
