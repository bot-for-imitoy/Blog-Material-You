#!/bin/sh
# Blog Material You — Docker entrypoint
# Starts MariaDB and OpenResty, keeps container running.

set -e

DB_DIR=/app/blog/data/mysql
DB_SOCKET=$DB_DIR/mysql.sock

# ===== Start MariaDB =====
echo "Starting MariaDB..."
mariadbd \
    --datadir="$DB_DIR" \
    --socket="$DB_SOCKET" \
    --port=3308 \
    --skip-grant-tables \
    --skip-networking \
    --pid-file=/tmp/mariadb.pid &
MARIADB_PID=$!

# Wait for MariaDB socket
for i in $(seq 1 15); do
    if [ -S "$DB_SOCKET" ]; then
        echo "MariaDB ready (PID: $MARIADB_PID)"
        break
    fi
    sleep 1
done

if [ ! -S "$DB_SOCKET" ]; then
    echo "ERROR: MariaDB failed to start"
    exit 1
fi

# ===== Initialize database if needed =====
MYSQL_CMD="mariadb --socket=$DB_SOCKET"
DB_EXISTS=$($MYSQL_CMD -e "SHOW DATABASES LIKE 'blogyou'" 2>/dev/null | grep blogyou || true)

if [ -z "$DB_EXISTS" ]; then
    echo "Initializing database schema..."
    $MYSQL_CMD < /app/docker/db_init.sql
    echo "Database initialized"
else
    echo "Database already exists, skipping init"
fi

# ===== Start OpenResty =====
echo "Starting OpenResty..."
cd /app/backend
mkdir -p logs tmp/body tmp/proxy tmp/fastcgi tmp/uwsgi tmp/scgi

/opt/openresty/bin/openresty -p /app/backend -c conf/nginx.conf
sleep 1

if pgrep -x nginx > /dev/null 2>&1; then
    echo "✅ Blog Material You is running"
    echo "   Frontend: http://localhost:30999/"
    echo "   Admin:    http://localhost:31000/"
else
    echo "ERROR: OpenResty failed to start"
    cat /app/backend/logs/error.log 2>/dev/null | tail -20
    exit 1
fi

# ===== Keep container running =====
# Tail the OpenResty access log to keep the process alive
touch /app/backend/logs/access.log
tail -f /app/backend/logs/access.log
