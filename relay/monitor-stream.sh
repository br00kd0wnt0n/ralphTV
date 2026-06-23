#!/bin/bash
# Monitor HLS stream and update status.json. Writes atomically (tmp + mv) so
# /api/status readers never see a half-written file.
set -uo pipefail
CONSECUTIVE_IDLE=0

write_status() {
  printf '%s' "$1" > /tmp/api/status.json.tmp 2>/dev/null && \
    mv -f /tmp/api/status.json.tmp /tmp/api/status.json 2>/dev/null
}

while true; do
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  # 6s freshness window (m3u8 updates every ~2s while live), so a Stop is detected in
  # ~6s instead of ~12s — halves the window where the player still thinks it's live.
  if [ -f /tmp/hls/stream.m3u8 ] && [ "$(find /tmp/hls/stream.m3u8 -mmin -0.1 2>/dev/null | wc -l)" -gt 0 ]; then
    write_status "{\"streaming\":true,\"lastUpdated\":\"$TIMESTAMP\"}"
    CONSECUTIVE_IDLE=0
  else
    write_status "{\"streaming\":false,\"lastUpdated\":\"$TIMESTAMP\"}"
    CONSECUTIVE_IDLE=$((CONSECUTIVE_IDLE + 1))
  fi
  # Back off when idle: 5s normally, up to 15s after sustained idle
  if [ $CONSECUTIVE_IDLE -gt 12 ]; then
    sleep 15
  else
    sleep 5
  fi
done
