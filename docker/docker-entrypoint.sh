#!/bin/sh
# Blog Material You — Docker entrypoint
# Starts MariaDB and OpenResty, keeps container running.

set -e

# ===== Set blog content directory =====
if [ -z "$BMY_BLOG_DIR" ]; then
    BMY_BLOG_DIR="/app/blog"
    export BMY_BLOG_DIR
fi

DB_DIR=/app/data/mysql
DB_SOCKET=$DB_DIR/mysql.sock

# Detect correct nginx binary
if [ -x /usr/sbin/nginx ]; then
    NGINX_BIN=/usr/sbin/nginx
    NGINX_CONF=/app/docker/nginx-docker.conf
    # Use Docker-specific admin config (no 127.0.0.1 restriction)
    cp -f /app/docker/31000-docker.conf /app/backend/conf/sites-available/31000.conf
    cp -f /app/docker/30999-docker.conf /app/backend/conf/sites-available/30999.conf
    mkdir -p "$BMY_BLOG_DIR/data" 2>/dev/null || true
    chmod 775 "$BMY_BLOG_DIR/data" 2>/dev/null || true
    chown :nginx "$BMY_BLOG_DIR/data" 2>/dev/null || true
    # Posts and pages bind mounts: make group-writable for nginx worker
    chmod -R g+w "$BMY_BLOG_DIR"/posts "$BMY_BLOG_DIR"/pages "$BMY_BLOG_DIR"/talks "$BMY_BLOG_DIR"/friends 2>/dev/null || true
    chown -R :nginx "$BMY_BLOG_DIR"/posts "$BMY_BLOG_DIR"/pages "$BMY_BLOG_DIR"/talks "$BMY_BLOG_DIR"/friends 2>/dev/null || true
elif [ -x /opt/openresty/bin/openresty ]; then
    NGINX_BIN=/opt/openresty/bin/openresty
    NGINX_CONF=/app/backend/conf/nginx.conf
else
    echo "ERROR: No nginx/openresty binary found"
    exit 1
fi

# ===== Generate session secret if not set =====
if [ -z "$BMY_SESSION_SECRET" ]; then
    BMY_SESSION_SECRET=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -tx1 | tr -d ' \\n')
    export BMY_SESSION_SECRET
    echo "Generated random BMY_SESSION_SECRET"
fi

# ===== Set blog content directory =====
# Expects BMY_BLOG_DIR to be set via docker-compose volume mount, or
# default to /app/blog if not set (Dockerfile copies blog/ to /app/).
if [ -z "$BMY_BLOG_DIR" ]; then
    BMY_BLOG_DIR="/app/blog"
    export BMY_BLOG_DIR
fi
echo "Blog content: $BMY_BLOG_DIR"

# ===== Start MariaDB =====
echo "Starting MariaDB..."

# Remove stale socket from previous run (volume persists it, fools readiness check)
rm -f "$DB_SOCKET"

mariadbd \
    --datadir="$DB_DIR" \
    --socket="$DB_SOCKET" \
    --port=3308 \
    --skip-networking \
    --user=mysql \
    --pid-file=/tmp/mariadb.pid &
MARIADB_PID=$!

# Wait for MariaDB to actually accept connections (not just create socket file)
MYSQL_CMD="mariadb --socket=$DB_SOCKET"
for i in $(seq 1 30); do
    if $MYSQL_CMD -e "SELECT 1" >/dev/null 2>&1; then
        echo "MariaDB ready (PID: $MARIADB_PID)"
        # Make socket accessible by nginx worker (group-readable)
        chmod 755 "$DB_DIR" 2>/dev/null || true
        chmod 666 "$DB_SOCKET" 2>/dev/null || true
        break
    fi
    sleep 1
done

if ! $MYSQL_CMD -e "SELECT 1" >/dev/null 2>&1; then
    echo "ERROR: MariaDB failed to start within 30 seconds"
    # Dump error log for debugging
    if [ -f "$DB_DIR/$(hostname).err" ]; then
        tail -30 "$DB_DIR/$(hostname).err"
    fi
    exit 1
fi

# ===== Initialize database if needed =====
MYSQL_CMD="mariadb --socket=$DB_SOCKET"
DB_EXISTS=$($MYSQL_CMD -e "SHOW DATABASES LIKE 'blogyou'" 2>/dev/null | grep blogyou || true)

if [ -z "$DB_EXISTS" ]; then
    echo "Initializing database schema..."
    $MYSQL_CMD < /app/docker/db_init.sql
    # Fresh start: clear any leftover admin credentials
    rm -f "$BMY_BLOG_DIR"/data/admin.json 2>/dev/null || true
    echo "Database initialized"
else
    echo "Database already exists, applying any pending schema migrations..."
    # Run only the DDL portion (CREATE TABLE IF NOT EXISTS — safe to re-run)
    $MYSQL_CMD blogyou -e "
        CREATE TABLE IF NOT EXISTS config (
            \`key\` VARCHAR(100) PRIMARY KEY,
            \`value\` TEXT NOT NULL,
            updated_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        CREATE TABLE IF NOT EXISTS emails (
            email VARCHAR(255) PRIMARY KEY,
            permissions TEXT NOT NULL DEFAULT '[]',
            created_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        CREATE TABLE IF NOT EXISTS pending_registrations (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            \`name\` VARCHAR(100) NOT NULL DEFAULT '',
            created_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        CREATE TABLE IF NOT EXISTS calendar_events (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL DEFAULT '',
            \`date\` VARCHAR(20) NOT NULL,
            description TEXT,
            color VARCHAR(20) DEFAULT '',
            created_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        CREATE TABLE IF NOT EXISTS page_content (
            slug VARCHAR(100) PRIMARY KEY,
            content_en TEXT,
            updated_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        -- Avatar column for comments (migration)
        ALTER TABLE comments ADD COLUMN IF NOT EXISTS avatar VARCHAR(500) NOT NULL DEFAULT '' AFTER url;
    "
    echo "Schema migration done"
fi

# Ensure nginx worker can access MySQL socket (directory gets 700 on fresh volume)
chmod 755 "$DB_DIR" 2>/dev/null || true
chown -R mysql:mysql "$DB_DIR" 2>/dev/null || true

# ===== Run JSON→DB migration (if not yet done) =====
echo "Running JSON→DB migration if needed..."

cat > /tmp/migrate.lua << 'MIGRATE_SCRIPT'
package.cpath = package.cpath .. ";/usr/lib/nginx/lualib/?.so"
local cjson = require("cjson")
-- BMY_BLOG_DIR placeholder — replaced at runtime:
local blog_dir = os.getenv("BMY_BLOG_DIR") or "/app/blog"
local DB_SOCKET = blog_dir .. "/data/mysql/mysql.sock"
local DATA_DIR  = blog_dir .. "/data"

local function run(sql)
    local f = io.popen("mariadb --socket=" .. DB_SOCKET .. " blogyou -N 2>/dev/null", "w")
    if f then f:write(sql); f:close() end
end

local function readfile(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local c = f:read("*a"); f:close()
    return c
end

-- Check if already done
local h = io.popen("mariadb --socket=" .. DB_SOCKET .. " blogyou -N -e \"SELECT 1 FROM config WHERE `key`='_migration_done_v1'\" 2>/dev/null")
local already = h and h:read("*a") or ""
if h then h:close() end
if already:match("1") then io.stderr:write("[migrate] Already done\n"); return end

io.stderr:write("[migrate] Starting migration...\n")

-- 1) Config blobs
local function mig_cfg(key, file)
    local c = readfile(file)
    if not c then return end
    local q = c:gsub("'", "''")
    run("REPLACE INTO config (`key`, `value`, updated_at) VALUES ('" .. key .. "','" .. q .. "'," .. os.time() .. ");\n")
    io.stderr:write("[migrate] OK " .. file .. "\n")
end

mig_cfg("admin_creds", DATA_DIR .. "/admin.json")
mig_cfg("totp_state", DATA_DIR .. "/totp.json")
mig_cfg("imghost_config", DATA_DIR .. "/imghost.json")

-- 2) emails.json → emails table
local c = readfile(DATA_DIR .. "/auth/emails.json")
if c then
    local ok, data = pcall(cjson.decode, c)
    if ok and type(data) == "table" then
        for email, entry in pairs(data) do
            local p = cjson.encode(entry.permissions or {})
            local t = entry.created_at or os.time()
            run("REPLACE INTO emails (email, permissions, created_at) VALUES (" .. cjson.encode(email) .. "," .. cjson.encode(p) .. "," .. t .. ");\n")
        end
    end
    io.stderr:write("[migrate] OK auth/emails.json\n")
end

-- 3) pending.json → pending_registrations
c = readfile(DATA_DIR .. "/auth/pending.json")
if c then
    local ok, data = pcall(cjson.decode, c)
    if ok and type(data) == "table" then
        for _, entry in ipairs(data) do
            local t = entry.time or entry.created_at or os.time()
            run("INSERT IGNORE INTO pending_registrations (email, name, created_at) VALUES (" .. cjson.encode(entry.email) .. "," .. cjson.encode(entry.name or "") .. "," .. t .. ");\n")
        end
    end
    io.stderr:write("[migrate] OK auth/pending.json\n")
end

-- 4) calendar/events.json
c = readfile(DATA_DIR .. "/calendar/events.json")
if c then
    local ok, data = pcall(cjson.decode, c)
    if ok and type(data) == "table" then
        for _, ev in ipairs(data) do
            run("INSERT INTO calendar_events (title, date, description, color, created_at) VALUES (" .. cjson.encode(ev.title or "") .. "," .. cjson.encode(ev.date or "") .. "," .. cjson.encode(ev.description or "") .. "," .. cjson.encode(ev.color or "") .. "," .. os.time() .. ");\n")
        end
    end
    io.stderr:write("[migrate] OK calendar/events.json\n")
end

-- 5) pages/*.en.json
local pages_handle = io.popen('ls "' .. blog_dir .. '/pages/*.en.json" 2>/dev/null')
if pages_handle then
    local count = 0
    for file in pages_handle:lines() do
        local slug = file:match("/([^/]+)%.en%.json$")
        if slug then
            local fc = readfile(file)
            if fc then
                local ok2, parsed = pcall(cjson.decode, fc)
                if ok2 and parsed then
                    run("REPLACE INTO page_content (slug, content_en, updated_at) VALUES (" .. cjson.encode(slug) .. "," .. cjson.encode(parsed.content_en or "") .. "," .. os.time() .. ");\n")
                    count = count + 1
                end
            end
        end
    end
    pages_handle:close()
    io.stderr:write("[migrate] OK pages/*.en.json (" .. count .. ")\n")
end

-- Mark done
run("REPLACE INTO config (`key`, `value`, updated_at) VALUES ('_migration_done_v1','1'," .. os.time() .. ");\n")
io.stderr:write("[migrate] Complete\n")
MIGRATE_SCRIPT

luajit /tmp/migrate.lua 2>&1
rm -f /tmp/migrate.lua
echo "Migration check done"

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
