#!/usr/bin/env bash
# Stop the Blog Material You backend
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="$SCRIPT_DIR/conf/nginx.conf"
PID="$SCRIPT_DIR/nginx.pid"

if [ -f "$PID" ]; then
    RUNNING_PID=$(cat "$PID" 2>/dev/null)
    echo "Stopping Blog Material You backend (PID: $RUNNING_PID)..."
    /opt/openresty/bin/openresty -p "$SCRIPT_DIR" -c "$CONF" -s stop 2>/dev/null || true
    sleep 1
    if [ -f "$PID" ]; then
        rm -f "$PID"
    fi
    echo "✅ Stopped."
else
    echo "No running instance found."
fi
