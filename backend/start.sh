#!/usr/bin/env bash
# Start the Blog Material You Backend using OpenResty with a self-contained config
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF="$SCRIPT_DIR/conf/nginx.conf"
LOGS="$SCRIPT_DIR/logs"
TMP="$SCRIPT_DIR/tmp"
PID="$SCRIPT_DIR/nginx.pid"

# Create required directories
mkdir -p "$LOGS" "$TMP/body" "$TMP/proxy" "$TMP/fastcgi" "$TMP/uwsgi" "$TMP/scgi"

# Kill any existing instance
if [ -f "$PID" ]; then
    OLD_PID=$(cat "$PID" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping existing instance (PID: $OLD_PID)..."
        /opt/openresty/bin/openresty -p "$SCRIPT_DIR" -c "$CONF" -s stop 2>/dev/null || true
        sleep 1
    fi
fi

echo "Starting Blog Material You on port 30999..."
/opt/openresty/bin/openresty -p "$SCRIPT_DIR" -c "$CONF"

sleep 1

# Check if it's running
if [ -f "$PID" ]; then
    RUNNING_PID=$(cat "$PID")
    echo "✅ Blog Material You backend started (PID: $RUNNING_PID)"
    echo "   Frontend: http://localhost:30999/"
    echo "   API:      http://localhost:30999/api/health"
else
    echo "❌ Failed to start. Check logs: $LOGS/error.log"
    cat "$LOGS/error.log" 2>/dev/null
    exit 1
fi
