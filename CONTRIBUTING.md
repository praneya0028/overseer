# Contributing

Thanks for looking! Overseer is a local, single-user control center for a fleet of
[cmux](https://cmux.com) AI coding agents. Issues and PRs are welcome — especially **cmux compatibility**,
**additional agent detection/adapters**, and **platform support** (it's macOS-only today).

## Dev setup

```bash
git clone https://github.com/praneya0028/overseer
cd overseer
npm install
npm run dev        # Vite on :5173, proxying /api + /ws to the daemon on :7878
```

- `npm run build` — client (Vite → `dist/client`) + server (`tsc` → `dist`)
- `npm start` — run the built daemon (`node dist/server/index.js`)
- `npm run typecheck` — both tsconfigs, no emit
- `npm test` — the scrollback-engine and safety-gate unit tests

## The bar for a PR

- `npm run typecheck` and `npm test` both pass.
- New behavior in the **scrollback engine** (`src/server/poller.ts`) or the **state machine /
  autopilot gates** comes with a unit test (`test/scrollback.test.mjs`, `test/safety.test.mjs` —
  both run against pure exports, no live cmux needed).
- Keep the **safety invariants** intact: high-risk / irreversible never auto-sends; only the Claude and
  Gemini adapters may emit a `waiting-*` state; the daemon binds `127.0.0.1` and never crashes on a bad
  request. If a change touches these, say so in the PR.

## Where things live

The architecture doc — [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — is the on-ramp: the file map, the
hard-won cmux integration gotchas, the pure state-machine, and the autopilot internals. In short:

- `src/server/cmux.ts` — the only thing that talks to cmux (persistent socket, JSON-RPC).
- `src/server/poller.ts` — the Fleet: heartbeat, reads, the deep-scrollback alignment engine.
- `src/server/state.ts` — pure state/model/mode derivation, per-vendor adapters.
- `src/server/autopilot.ts` + `brain.ts` — the head-agent engine, risk gates, and the `claude -p` call.
- `src/client/` — the React + Zustand UI over a WebSocket.

## Adding an agent adapter

cmux already classifies agents by type. To support a new one, teach `deriveState` (`src/server/state.ts`)
how that TUI renders working/waiting and how its menus are answered, and add a send path in
`autopilot.ts` if it needs different keystrokes. **Only emit a `waiting-*` state once you've actually
verified the TUI** — an unverified adapter must stay watch-only so autopilot never fires blind.

By contributing you agree your work is licensed under the project's **MIT** license.
