#!/bin/bash
set -euo pipefail

echo "==> Relay entrypoint starting..."

# Generate push lines from RELAY_PUSH_1..RELAY_PUSH_5
PUSH_LINES=""
PUSH_JSON_ARRAY=""

for i in 1 2 3 4 5; do
  VAR="RELAY_PUSH_${i}"
  VAL="${!VAR:-}"
  if [ -n "$VAL" ]; then
    echo "==> Found RELAY_PUSH_${i}: $VAL"
    PUSH_LINES+=$'      push '
    PUSH_LINES+="$VAL"
    PUSH_LINES+=$';\n'

    # Extract platform name from RTMP URL for JSON
    PLATFORM=$(echo "$VAL" | sed -E 's|rtmps?://([^/]+)/.*|\1|' | sed -E 's/.*\.(youtube|twitch|facebook|restream).*/\1/')
    if [ "$PUSH_JSON_ARRAY" != "" ]; then
      PUSH_JSON_ARRAY+=","
    fi
    PUSH_JSON_ARRAY+="\"$PLATFORM\""
  fi
done

export RELAY_PUSH_LINES="$PUSH_LINES"

# Generate JSON files for API endpoints
echo "==> Creating /tmp/api directory..."
mkdir -p /tmp/api

if [ -n "$PUSH_JSON_ARRAY" ]; then
  echo "{\"destinations\":[$PUSH_JSON_ARRAY]}" > /tmp/api/destinations.json
  echo "==> Destinations: [$PUSH_JSON_ARRAY]"
else
  echo '{"destinations":[]}' > /tmp/api/destinations.json
  echo "==> No destinations configured"
fi

# Initialize status as not streaming
echo '{"streaming":false}' > /tmp/api/status.json

echo "==> Generating nginx config..."
envsubst < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

echo "==> Starting stream monitor in background..."
/monitor-stream.sh &

echo "==> Starting nginx..."
exec "$@"

