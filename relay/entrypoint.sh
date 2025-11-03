#!/bin/bash
set -euo pipefail

# Generate push lines from RELAY_PUSH_1..RELAY_PUSH_5
PUSH_LINES=""
for i in 1 2 3 4 5; do
  VAR="RELAY_PUSH_${i}"
  VAL="${!VAR:-}"
  if [ -n "$VAL" ]; then
    PUSH_LINES+=$'      push '
    PUSH_LINES+="$VAL"
    PUSH_LINES+=$';\n'
  fi
done

export RELAY_PUSH_LINES="$PUSH_LINES"

envsubst < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

exec "$@"

