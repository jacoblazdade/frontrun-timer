#!/usr/bin/env bash
#
# Race-day keep-warm ping.
#
# Neon suspends its compute after ~5 minutes without a query, so the first
# request after a lull pays a 1-3s wake-up. This hits a real DB-backed
# endpoint every 4 minutes so the database is already awake when someone
# opens the results page.
#
# Run it on race morning and leave it going for the event:
#
#     caffeinate -i ./scripts/keep-warm.sh https://<your-app>.fly.dev/api/public/events
#
# `caffeinate -i` stops the Mac idle-sleeping out from under the loop. It does
# NOT survive the lid closing — this is a race-day tool, not a 24/7 monitor.
# Stop it with Ctrl-C. Nothing to clean up afterwards.
#
# Args:  keep-warm.sh <url> [interval_seconds]

set -uo pipefail

URL="${1:?usage: keep-warm.sh <url> [interval_seconds]}"
INTERVAL="${2:-240}"

sleep_pid=""
trap 'printf "\nstopped\n"; [ -n "$sleep_pid" ] && kill "$sleep_pid" 2>/dev/null; exit 0' INT TERM

printf 'keeping warm: %s\nevery %ss — Ctrl-C to stop\n\n' "$URL" "$INTERVAL"

while true; do
  # %{http_code} and %{time_total} tell us awake-vs-cold at a glance: a warm
  # hit is ~0.1s, a wake-up from suspend is a second or more.
  result=$(curl -s -o /dev/null -w '%{http_code} %{time_total}s' --max-time 30 "$URL") \
    || result="FAILED (no response)"
  printf '%s  %s\n' "$(date '+%H:%M:%S')" "$result"
  # Sleep in the background and wait on it: bash defers a trap until the
  # current foreground child exits, so a plain `sleep 240` would leave
  # `kill <pid>` hanging for up to four minutes. `wait` is interruptible.
  sleep "$INTERVAL" &
  sleep_pid=$!
  wait "$sleep_pid" 2>/dev/null || true
done
