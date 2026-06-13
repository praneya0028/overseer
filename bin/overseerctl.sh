#!/usr/bin/env bash
# overseerctl — control the Overseer daemon: start | stop | restart | status | logs
set -euo pipefail
OVERSEER_DIR="${OVERSEER_DIR:-$HOME/Code/overseer}"
PORT="${OVERSEER_PORT:-7878}"
RUN_DIR="$OVERSEER_DIR/.overseer"
PIDFILE="$RUN_DIR/server.pid"
LOG="$RUN_DIR/server.log"
URL="http://localhost:${PORT}"

# Only ever signal a PID we've CONFIRMED is our daemon (its argv is our index.js).
# A stale PIDFILE can point at a recycled, unrelated process after a hard
# death/reboot — blindly signaling it would take down someone else's process.
pid_is_ours() { local p="$1"; [[ -n "$p" ]] && ps -p "$p" -o command= 2>/dev/null | grep -q "$OVERSEER_DIR/dist/server/index.js"; }

case "${1:-status}" in
  start)   "$OVERSEER_DIR/bin/overseer.sh" ;;
  stop)
    if [[ -f "$PIDFILE" ]]; then
      p="$(cat "$PIDFILE" 2>/dev/null || true)"
      if pid_is_ours "$p"; then
        kill "$p" 2>/dev/null || true
        for _ in $(seq 1 10); do curl -fsS --max-time 1 "$URL/health" >/dev/null 2>&1 || break; sleep 0.5; done
        pid_is_ours "$p" && kill -9 "$p" 2>/dev/null || true
        echo "overseer: stopped"
      else
        echo "overseer: stale pidfile (pid not our daemon) — not killing"
      fi
      rm -f "$PIDFILE"
    else echo "overseer: not running"; fi ;;
  restart) "$0" stop; sleep 0.5; "$OVERSEER_DIR/bin/overseer.sh" ;;
  status)
    if curl -fsS --max-time 2 "$URL/health" 2>/dev/null; then echo; else echo "overseer: not healthy"; fi ;;
  logs)    tail -f "$LOG" ;;
  *) echo "usage: overseerctl {start|stop|restart|status|logs}"; exit 1 ;;
esac
