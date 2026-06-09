#!/usr/bin/env bash
# overseer — launch the mission-control console inside cmux.
# Idempotent: ensures the daemon is up (building if needed), then opens (or
# focuses) the Overseer UI in a cmux browser pane. Run it as many times as you like.
set -euo pipefail

OVERSEER_DIR="${OVERSEER_DIR:-$HOME/Code/overseer}"
PORT="${OVERSEER_PORT:-7878}"
URL="http://localhost:${PORT}"
RUN_DIR="$OVERSEER_DIR/.overseer"
PIDFILE="$RUN_DIR/server.pid"
LOG="$RUN_DIR/server.log"
CMUX_BIN="${CMUX_BIN:-${CMUX_BUNDLED_CLI_PATH:-/Applications/cmux.app/Contents/Resources/bin/cmux}}"

mkdir -p "$RUN_DIR"
health_ok() { curl -fsS --max-time 2 "$URL/health" >/dev/null 2>&1; }
# cmux_linked: the daemon answers AND has REAL cmux data right now (≥1 poll landed
# and the link is up). `cmuxReady` (not the optimistic `cmuxOk`) is the truthful
# signal — a daemon left over from a previous session, or one still in its first
# poll, reports cmuxReady=false. We never reuse a not-ready daemon; we restart it
# fresh. This is the fix for "launch → No agents, refresh forever."
cmux_linked() { curl -fsS --max-time 2 "$URL/health" 2>/dev/null | grep -q '"cmuxReady":true'; }
# Only ever signal a pid we've CONFIRMED is our daemon (its argv is our index.js).
# A stale PIDFILE can point at a recycled, unrelated user process after a hard
# death/reboot — blindly signaling it would take down someone else's process.
pid_is_ours() { local p="$1"; [[ -n "$p" ]] && ps -p "$p" -o command= 2>/dev/null | grep -q "$OVERSEER_DIR/dist/server/index.js"; }
proc_alive() { local p; p="$(cat "$PIDFILE" 2>/dev/null || true)"; pid_is_ours "$p" && kill -0 "$p" 2>/dev/null; }
port_free() { ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }
# Stop the daemon AND block until the port is actually free, escalating to
# SIGKILL. Without this, a fresh start can race the old daemon's ~1.5s shutdown
# drain, hit EADDRINUSE, and exit — leaving ZERO daemons (the very "no agents"
# bug we're fixing). Returns only once nothing is listening on $PORT.
stop_daemon_proc() {
  local p; p="$(cat "$PIDFILE" 2>/dev/null || true)"
  pid_is_ours "$p" && kill "$p" 2>/dev/null || true
  pkill -f "$OVERSEER_DIR/dist/server/index.js" 2>/dev/null || true
  rm -f "$PIDFILE"
  for _ in $(seq 1 20); do port_free && return 0; sleep 0.25; done  # up to ~5s graceful
  pkill -9 -f "$OVERSEER_DIR/dist/server/index.js" 2>/dev/null || true
  for _ in $(seq 1 8); do port_free && return 0; sleep 0.25; done   # up to ~2s after SIGKILL
}

close_console() {
  # close any cmux browser pane showing the Overseer URL
  "$CMUX_BIN" rpc system.tree '{"all":true}' 2>/dev/null \
    | PORT="$PORT" python3 -c '
import sys, json, os
port = os.environ["PORT"]
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for w in d.get("windows", []):
  for ws in w.get("workspaces", []):
    for p in ws.get("panes", []):
      for s in p.get("surfaces", []):
        if s.get("type") == "browser" and ("localhost:%s" % port) in (s.get("url") or ""):
          print(s["id"])
' 2>/dev/null | while read -r sid; do "$CMUX_BIN" rpc surface.close "{\"surface_id\":\"$sid\"}" >/dev/null 2>&1 || true; done
}

# ---- subcommands: stop / close / restart / status ----
case "${1:-}" in
  stop|close|down|quit|off)
    close_console
    stop_pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    pid_is_ours "$stop_pid" && kill "$stop_pid" 2>/dev/null || true
    pkill -f "$OVERSEER_DIR/dist/server/index.js" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "overseer: stopped (daemon + console closed)" >&2
    exit 0 ;;
  status)
    if health_ok; then echo "overseer: running — $(curl -fsS "$URL/health")"; else echo "overseer: not running"; fi
    exit 0 ;;
  restart)
    "$0" stop >/dev/null 2>&1 || true; sleep 0.5 ;;  # fall through to start
esac

ensure_built() {
  if [[ ! -f "$OVERSEER_DIR/dist/server/index.js" ]] \
     || [[ ! -f "$OVERSEER_DIR/dist/client/index.html" ]] \
     || [[ -n "$(find "$OVERSEER_DIR/src" -newer "$OVERSEER_DIR/dist/server/index.js" -type f 2>/dev/null | head -1)" ]]; then
    echo "overseer: building…" >&2
    ( cd "$OVERSEER_DIR" && npm run build >>"$LOG" 2>&1 )
  fi
}

start_daemon() {
  ensure_built
  echo "overseer: starting daemon on :$PORT" >&2
  # NO subshell: launching node inside `( … )` breaks its connection to the cmux
  # control socket (cmux drops a connection opened from a subshell process context
  # → cmuxOk=false → "No agents yet"). nohup + & directly works. The daemon finds
  # its files via OVERSEER_DIR (not cwd), so no `cd` is needed.
  OVERSEER_PORT="$PORT" OVERSEER_DIR="$OVERSEER_DIR" CMUX_BIN="$CMUX_BIN" \
    nohup node "$OVERSEER_DIR/dist/server/index.js" >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  # Wait for the daemon to come up AND link to cmux, so the UI opens already
  # populated (no blank "No agents yet" flash). If cmux is genuinely down, fall
  # back to healthy-but-unlinked after a short grace so we never hang.
  for _ in $(seq 1 10); do cmux_linked && return 0; sleep 0.5; done   # ~5s
  if health_ok; then echo "overseer: started (cmux not detected yet — open a cmux agent)" >&2; return 0; fi
  echo "overseer: ERROR daemon did not become healthy — tail $LOG" >&2
  tail -n 20 "$LOG" >&2 || true
  return 1
}

# 1) A process is listening on the port but not answering /health. It's either
#    OUR OWN daemon (wedged, or mid-shutdown draining the port) or a genuinely
#    foreign server. Only bail for a foreign one — for our own, fall through to the
#    restart logic below (otherwise we'd refuse to self-heal a wedged daemon).
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! health_ok; then
  listener_pid="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  own=0
  if [[ -f "$PIDFILE" && -n "$listener_pid" && "$(cat "$PIDFILE")" == "$listener_pid" ]]; then own=1; fi
  if [[ -n "$listener_pid" ]] && ps -p "$listener_pid" -o command= 2>/dev/null | grep -q "$OVERSEER_DIR/dist/server/index.js"; then own=1; fi
  if [[ "$own" == 1 ]]; then
    echo "overseer: own daemon wedged on :$PORT — restarting fresh" >&2
    stop_daemon_proc; start_daemon
    daemon_ready=1   # already (re)started here — don't let step 2 restart it again
  else
    echo "overseer: ERROR port $PORT is busy and not Overseer. Set OVERSEER_PORT to use another." >&2
    exit 1
  fi
fi

# 2) ensure a daemon that is healthy AND linked to cmux — the root cause of
#    "launch → no agents → refresh forever" was reusing one that wasn't linked.
if [[ "${daemon_ready:-0}" == 1 ]]; then
  : # step 1 already started a fresh daemon — nothing more to do
elif health_ok && cmux_linked; then
  echo "overseer: daemon healthy — cmux linked" >&2
elif health_ok; then
  # Daemon responds but isn't linked yet. A live daemon self-heals (it re-resolves
  # the cmux socket every reconnect), so cmux that just reopened relinks within ~1-2s.
  # Give it a grace window BEFORE restarting — this avoids tearing down (and losing
  # autopilot state on) a perfectly good daemon when cmux is merely down/restarting.
  echo "overseer: daemon up — waiting for cmux link to settle…" >&2
  linked=0
  for _ in $(seq 1 10); do cmux_linked && { linked=1; break; }; sleep 0.5; done   # ~5s self-heal grace
  if [[ "$linked" == 1 ]]; then
    echo "overseer: daemon healthy — cmux linked" >&2
  else
    echo "overseer: cmux link won't settle — restarting daemon fresh" >&2
    stop_daemon_proc; start_daemon
  fi
elif proc_alive; then
  echo "overseer: daemon unresponsive — restarting fresh" >&2
  stop_daemon_proc; start_daemon
else
  rm -f "$PIDFILE"; start_daemon
fi

# 3) focus existing UI pane, else open a fresh browser pane
EXISTING="$("$CMUX_BIN" rpc system.tree '{"all":true}' 2>/dev/null \
  | PORT="$PORT" python3 -c '
import sys, json, os
port = os.environ["PORT"]
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
for w in d.get("windows", []):
  for ws in w.get("workspaces", []):
    for p in ws.get("panes", []):
      for s in p.get("surfaces", []):
        if s.get("type") == "browser" and ("localhost:%s" % port) in (s.get("url") or ""):
          print(s["id"]); sys.exit(0)
' 2>/dev/null || true)"

if [[ -n "$EXISTING" ]]; then
  "$CMUX_BIN" rpc surface.focus "{\"surface_id\":\"$EXISTING\"}" >/dev/null 2>&1 || true
  echo "overseer: focused existing console" >&2
else
  "$CMUX_BIN" new-pane --type browser --url "$URL" --focus true >/dev/null 2>&1 \
    || "$CMUX_BIN" open "$URL" >/dev/null 2>&1 || true
  echo "overseer: opened console → $URL" >&2
fi
