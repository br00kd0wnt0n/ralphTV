#!/usr/bin/env bash
# Poll streamer + relay status every 2s and print only when something changes.
# Run this in a terminal while replicating the asset-delete drop, then paste the
# output alongside the Railway logs for the same window.
#
#   ./scripts/watch-stream.sh            # uses production URLs below
#   STREAMER=... BACKEND=... ./scripts/watch-stream.sh
set -u
STREAMER="${STREAMER:-https://streamer-production-5c6d.up.railway.app}"
BACKEND="${BACKEND:-https://backend-production-3f879.up.railway.app}"
prev=""
echo "$(date -u +%FT%TZ) watching $STREAMER/status + $BACKEND/api/relay/status (ctrl-c to stop)"
while true; do
  s=$(curl -s -m 5 "$STREAMER/status" || echo '{"error":"streamer unreachable"}')
  r=$(curl -s -m 5 "$BACKEND/api/relay/status" || echo '{"error":"backend unreachable"}')
  running=$(echo "$s" | sed -n 's/.*"running":\([a-z]*\).*/\1/p')
  started=$(echo "$s" | sed -n 's/.*"sessionStartedAt":\([0-9null]*\).*/\1/p')
  asset=$(echo "$s" | sed -n 's/.*"assetId":"\([^"]*\)".*/\1/p')
  streaming=$(echo "$r" | sed -n 's/.*"streaming":\([a-z]*\).*/\1/p')
  cur="running=$running streaming=$streaming sessionStartedAt=$started asset=$asset"
  if [ "$cur" != "$prev" ]; then
    echo "$(date -u +%FT%TZ) $cur"
    prev="$cur"
  fi
  sleep 2
done
