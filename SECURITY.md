# Security

## Threat model

Overseer is a **local, single-user tool**. The daemon binds `127.0.0.1` only and is never meant to be
exposed to a network. Anything that can already run code as your user on your machine is outside the
threat model (it could read the cmux socket directly anyway). What Overseer *does* defend against:

- **Drive-by web pages.** Binding to loopback alone does **not** stop a page you visit from reaching
  `ws://localhost`. The WebSocket upgrade and every mutating HTTP route are **Origin-gated** (only
  `127.0.0.1`/`localhost` on the configured port), which blocks cross-site WebSocket hijacking and CSRF.
- **A supervised agent going off the rails.** The autopilot brain reads an agent's on-screen text, but a
  decision is only sent after deterministic risk gates + a destructive deny-list (normalized against
  homoglyph/zero-width tricks) + a screen re-read. High-risk / irreversible actions never auto-send.
- **Injection surfaces.** The brain is invoked via `execFile` (no shell); the runtime-settable model id is
  validated; static file serving strips path traversal; request bodies are size-capped; a malformed
  request can never crash the daemon.

Nothing is uploaded and there is no telemetry. Everything written to disk stays under `.overseer/`
(gitignored): the decision log, standing orders, the PID file, and the daemon log. No secrets are logged.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Instead, open a
[private security advisory](https://github.com/praneya0028/overseer/security/advisories/new) on the repo,
or email the maintainer. Include repro steps and the affected version/commit. You'll get an
acknowledgement as soon as possible.

## Scope notes

- Once a local Origin-allowed client is connected, it can type into any cmux terminal Overseer controls —
  this is by design (it's the same authority you have at the keyboard) and is **not** a vulnerability.
- The autopilot deny-list is **defense in depth**, not the primary safety mechanism — the brain's
  risk/reversibility judgment and the tiered gates are. Report a way to get a genuinely destructive action
  **auto-sent** (not merely a deny-list word that isn't matched).
