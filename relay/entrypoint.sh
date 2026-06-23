#!/bin/bash
set -euo pipefail

echo "==> Relay entrypoint starting..."

# Set default ports if not provided
RELAY_HTTP_PORT="${RELAY_HTTP_PORT:-8080}"
RELAY_RTMP_PORT="${RELAY_RTMP_PORT:-1935}"

# If running on platforms that provide PORT (e.g., Railway), map it to RELAY_HTTP_PORT
# BUT: ignore if PORT=1935 (that's the RTMP port from TCP proxy, not HTTP)
if [ -n "${PORT:-}" ] && [ "${PORT}" != "1935" ]; then
  RELAY_HTTP_PORT="$PORT"
  echo "==> Using PORT from environment: RELAY_HTTP_PORT=$RELAY_HTTP_PORT"
else
  echo "==> Using default RELAY_HTTP_PORT=$RELAY_HTTP_PORT (PORT=${PORT:-not set})"
fi

# Export for envsubst
export RELAY_HTTP_PORT
export RELAY_RTMP_PORT
export NGINX_WORKER_PROCESSES="${NGINX_WORKER_PROCESSES:-auto}"

# Generate push lines from RELAY_PUSH_1..RELAY_PUSH_5
PUSH_LINES=""
PUSH_JSON_ARRAY=""

# Strict allowlist for push URLs. These values are interpolated directly into the
# nginx config, so a value containing ';', '}', whitespace or a newline could inject
# arbitrary nginx directives. Reject anything that isn't a plain rtmp(s) URL.
RTMP_URL_RE='^rtmps?://[A-Za-z0-9._~:/?=&%@-]+$'

for i in 1 2 3 4 5; do
  VAR="RELAY_PUSH_${i}"
  VAL="${!VAR:-}"
  if [ -n "$VAL" ]; then
    if ! [[ "$VAL" =~ $RTMP_URL_RE ]]; then
      echo "ERROR: RELAY_PUSH_${i} is not a valid rtmp(s) URL; refusing to start" >&2
      exit 1
    fi
    # Redact the stream key (last path segment) so secrets never reach Railway logs.
    REDACTED="$(echo "$VAL" | sed -E 's|/[^/]+$|/***|')"
    echo "==> Found RELAY_PUSH_${i}: ${REDACTED}"
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

# Opt-in RTMP publish auth. When RELAY_PUBLISH_AUTH_URL is set, nginx-rtmp POSTs every
# publish attempt to that URL (the backend validates the ?key= arg against
# RELAY_PUBLISH_KEY and returns 2xx to allow, 4xx to deny). Unset => open ingest,
# preserving current behaviour until you configure it.
RELAY_ON_PUBLISH=""
HTTP_URL_RE='^https?://[A-Za-z0-9._~:/?=&%@-]+$'
if [ -n "${RELAY_PUBLISH_AUTH_URL:-}" ]; then
  if ! [[ "${RELAY_PUBLISH_AUTH_URL}" =~ $HTTP_URL_RE ]]; then
    echo "ERROR: RELAY_PUBLISH_AUTH_URL is not a valid http(s) URL; refusing to start" >&2
    exit 1
  fi
  RELAY_ON_PUBLISH="on_publish ${RELAY_PUBLISH_AUTH_URL};"
  echo "==> Publish auth ENABLED (on_publish -> ${RELAY_PUBLISH_AUTH_URL})"
else
  echo "==> Publish auth DISABLED (set RELAY_PUBLISH_AUTH_URL to enable)"
fi
export RELAY_ON_PUBLISH

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
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"streaming\":false,\"lastUpdated\":\"$TIMESTAMP\"}" > /tmp/api/status.json

echo "==> Generating nginx config..."
echo "==> RELAY_HTTP_PORT=${RELAY_HTTP_PORT}"
echo "==> RELAY_RTMP_PORT=${RELAY_RTMP_PORT}"
echo "==> NGINX_WORKER_PROCESSES=${NGINX_WORKER_PROCESSES}"
# Only substitute our variables, not nginx variables like $request_method
envsubst '${NGINX_WORKER_PROCESSES} ${RELAY_RTMP_PORT} ${RELAY_PUSH_LINES} ${RELAY_ON_PUBLISH} ${RELAY_HTTP_PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

echo "==> Generated config:"
cat /etc/nginx/nginx.conf

echo "==> Testing nginx config..."
nginx -t 2>&1 || {
  echo "ERROR: nginx config test failed"
  cat /etc/nginx/nginx.conf
  exit 1
}

echo "==> Starting stream monitor (auto-restart) in background..."
# Supervise: if the monitor dies, relaunch it so /api/status never freezes forever.
( while true; do /monitor-stream.sh; echo "==> monitor-stream exited, restarting in 1s"; sleep 1; done ) &

echo "==> Starting nginx..."
exec "$@"
