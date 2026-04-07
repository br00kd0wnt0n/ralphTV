#!/bin/bash
# Monitor HLS stream and update status.json
CONSECUTIVE_IDLE=0
while true; do
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  if [ -f /tmp/hls/stream.m3u8 ]; then
    # Check if file was modified in the last 10 seconds
    if [ $(find /tmp/hls/stream.m3u8 -mmin -0.2 2>/dev/null | wc -l) -gt 0 ]; then
      echo "{\"streaming\":true,\"lastUpdated\":\"$TIMESTAMP\"}" > /tmp/api/status.json
      CONSECUTIVE_IDLE=0
    else
      echo "{\"streaming\":false,\"lastUpdated\":\"$TIMESTAMP\"}" > /tmp/api/status.json
      CONSECUTIVE_IDLE=$((CONSECUTIVE_IDLE + 1))
    fi
  else
    echo "{\"streaming\":false,\"lastUpdated\":\"$TIMESTAMP\"}" > /tmp/api/status.json
    CONSECUTIVE_IDLE=$((CONSECUTIVE_IDLE + 1))
  fi
  # Back off when idle: 5s normally, up to 15s after sustained idle
  if [ $CONSECUTIVE_IDLE -gt 12 ]; then
    sleep 15
  else
    sleep 5
  fi
done
