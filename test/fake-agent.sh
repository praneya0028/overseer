#!/usr/bin/env bash
# fake-agent.sh — simulates a Claude Code agent that STALLS on a permission prompt.
# Used ONLY against a SAFE dummy cmux workspace to verify Overseer autopilot end-to-end.
# It prints a realistic Claude-style permission box, waits for input, and prints a
# unique sentinel when it receives an approval — so the test can confirm the brain answered.
echo "✻ Crunching…  (12s · ↑ 2.1k tokens)"
sleep 1
# Claude removes the spinner when it stops to ask — clear it so only the box remains.
clear
printf '  I want to run: npm run build to verify the change compiles.\n\n'
cat <<'BOX'
╭───────────────────────────────────────────────╮
│ Do you want to proceed?                       │
│                                               │
│ ❯ 1. Yes                                      │
│   2. Yes, and don't ask again this session    │
│   3. No, and tell Claude what to do instead   │
╰───────────────────────────────────────────────╯
BOX
printf '\n'
read -r ans
if [[ "$ans" == "1" || "$ans" =~ ^[Yy] ]]; then
  echo "⏺ Proceeding — build started. OVERSEER_AUTOPILOT_CONFIRMED ✓"
else
  echo "⏺ Holding. Received: '$ans'"
fi
printf '\n❯ \n'
sleep 600
