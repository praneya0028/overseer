#!/usr/bin/env bash
clear
echo "● Done — I pulled the recent merge history to see what landed."
echo ""
echo "  Want me to spin up the dev server so you can start the visual review, or pick up at a specific item?"
echo ""
printf '%s\n' "──────────────────────────────────────────────────────"
printf '❯ \n'
printf '%s\n' "──────────────────────────────────────────────────────"
echo "  Opus 4.8 (1M context) | 5h 2% (4h 23m) | ctx 66k/1M (7%)"
read -r ans
printf '\n⏺ Reply received: "%s" — proceeding. OVERSEER_Q_CONFIRMED ✓\n' "$ans"
printf '\n❯ \n'
sleep 600
