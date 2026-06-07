#!/bin/sh
# Blog Material You — Docker entrypoint
# Starts MariaDB and OpenResty, keeps container running.

set -e

DB_DIR=/app/blog/data/mysql
DB_SOCKET=$DB_DIR/mysql.sock

# Detect correct nginx binary
if [ -x /usr/sbin/nginx ]; then
    NGINX_BIN=/usr/sbin/nginx
    NGINX_CONF=/app/docker/nginx-docker.conf
    # Use Docker-specific admin config (no 127.0.0.1 restriction)
    cp -f /app/docker/31000-docker.conf /app/backend/conf/sites-available/31000.conf
    # Ensure data directories have correct permissions
    chmod 775 /app/blog/data 2>/dev/null || true  # nginx writes admin.json here
    chown :nginx /app/blog/data 2>/dev/null || true
elif [ -x /opt/openresty/bin/openresty ]; then
    NGINX_BIN=/opt/openresty/bin/openresty
    NGINX_CONF=/app/backend/conf/nginx.conf
else
    echo "ERROR: No nginx/openresty binary found"
    exit 1
fi

# ===== Generate session secret if not set =====
if [ -z "$BMY_SESSION_SECRET" ]; then
    BMY_SESSION_SECRET=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \n')
    export BMY_SESSION_SECRET
    echo "Generated random BMY_SESSION_SECRET"
fi

# ===== Start MariaDB =====
echo "Starting MariaDB..."
mariadbd \
    --datadir="$DB_DIR" \
    --socket="$DB_SOCKET" \
    --port=3308 \
    --skip-networking \
    --user=mysql \
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
    # Fresh start: clear any leftover admin credentials
    rm -f /app/blog/data/admin.json 2>/dev/null || true
    echo "Database initialized"
else
    echo "Database already exists, skipping init"
fi

# Ensure nginx worker can access MySQL socket (directory gets 700 on fresh volume)
chmod 755 "$DB_DIR" 2>/dev/null || true
chown -R mysql:mysql "$DB_DIR" 2>/dev/null || true

# ===== Start OpenResty =====
echo "Starting OpenResty..."
cd /app/backend
mkdir -p logs tmp/body tmp/proxy tmp/fastcgi tmp/uwsgi tmp/scgi

$NGINX_BIN -p /app/backend -c "$NGINX_CONF" 2>&1 || true
sleep 1

if pgrep nginx > /dev/null 2>&1; then
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
