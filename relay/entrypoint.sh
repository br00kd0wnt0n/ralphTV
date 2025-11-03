#!/bin/bash
set -euo pipefail

echo "==> Relay entrypoint starting..."

# Set default ports if not provided
RELAY_HTTP_PORT="${RELAY_HTTP_PORT:-8080}"
RELAY_RTMP_PORT="${RELAY_RTMP_PORT:-1935}"

# If running on platforms that provide PORT (e.g., Railway), map it to RELAY_HTTP_PORT
if [ -n "${PORT:-}" ]; then
  RELAY_HTTP_PORT="$PORT"
  echo "==> Using PORT from environment: RELAY_HTTP_PORT=$RELAY_HTTP_PORT"
fi

# Export for envsubst
export RELAY_HTTP_PORT
export RELAY_RTMP_PORT
export NGINX_WORKER_PROCESSES="${NGINX_WORKER_PROCESSES:-auto}"

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
echo "==> Creating directories..."
mkdir -p /tmp/api /tmp/hls

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
echo "==> RELAY_HTTP_PORT=${RELAY_HTTP_PORT}"
echo "==> RELAY_RTMP_PORT=${RELAY_RTMP_PORT}"
envsubst < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

echo "==> Testing nginx config..."
nginx -t

echo "==> Starting stream monitor in background..."
/monitor-stream.sh &

echo "==> Starting nginx..."
exec "$@"
