#!/bin/bash
# Monitor HLS stream and update status.json
while true; do
  if [ -f /tmp/hls/live.m3u8 ]; then
    # Check if file was modified in the last 10 seconds
    if [ $(find /tmp/hls/live.m3u8 -mmin -0.2 2>/dev/null | wc -l) -gt 0 ]; then
      echo '{"streaming":true}' > /tmp/api/status.json
    else
      echo '{"streaming":false}' > /tmp/api/status.json
    fi
  else
    echo '{"streaming":false}' > /tmp/api/status.json
  fi
  sleep 5
done
