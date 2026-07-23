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
  # 6s freshness window: a new segment is written every ~2s while live. We watch for a
  # fresh *.ts (not stream.m3u8) because in ABR mode stream.m3u8 is a STATIC master
  # playlist that never updates — only the variant playlists/segments do. Watching
  # segments works for both single-rendition and ABR. Detects a Stop in ~6s.
  if [ "$(find /tmp/hls -name '*.ts' -mmin -0.1 2>/dev/null | head -1 | wc -l)" -gt 0 ]; then
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
