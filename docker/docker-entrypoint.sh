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
        -- New tables for file-to-DB migration
        CREATE TABLE IF NOT EXISTS posts (
            slug VARCHAR(200) PRIMARY KEY,
            title TEXT NOT NULL,
            content LONGTEXT NOT NULL DEFAULT '',
            `date` VARCHAR(20) NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]',
            categories TEXT NOT NULL DEFAULT '[]',
            cover TEXT,
            archived INT UNSIGNED NOT NULL DEFAULT 0,
            title_en TEXT,
            content_en LONGTEXT,
            tags_en TEXT NOT NULL DEFAULT '[]',
            categories_en TEXT NOT NULL DEFAULT '[]',
            created_at INT UNSIGNED NOT NULL,
            updated_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        CREATE TABLE IF NOT EXISTS pages (
            slug VARCHAR(100) PRIMARY KEY,
            title TEXT NOT NULL,
            content LONGTEXT NOT NULL DEFAULT '',
            title_en TEXT,
            content_en LONGTEXT,
            updated_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        CREATE TABLE IF NOT EXISTS friends (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            descr TEXT,
            title_en VARCHAR(200),
            descr_en TEXT,
            avatar VARCHAR(500) DEFAULT '',
            url VARCHAR(500) NOT NULL DEFAULT '#',
            sort_order INT DEFAULT 0,
            created_at INT UNSIGNED NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
local DB_SOCKET = os.getenv("BMY_DB_SOCKET") or blog_dir .. "/data/mysql/mysql.sock"
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

-- ====== FILE TO DB MIGRATION ======
-- Import blog/posts/*.md into posts table
local function escape_sql(val)
    if not val then return "''" end
    return "'" .. tostring(val):gsub("'", "''"):gsub("\\", "\\\\") .. "'"
end

local function parse_frontmatter_v2(text)
    local meta = {}
    for line in text:gmatch("[^\r\n]+") do
        local key, val = line:match("^([%w_]+):%s*(.*)")
        if key then
            val = val:match("^%s*(.-)%s*$") -- trim
            -- Parse inline list like [a, b]
            if val:match("^%[.*%]$") then
                local items = {}
                for item in val:gsub("[%[%]]", ""):gmatch("[^,]+") do
                    local trimmed = item:match("^%s*(.-)%s*$")
                    table.insert(items, trimmed)
                end
                meta[key] = items
            else
                meta[key] = val
            end
        end
    end
    return meta
end

local function parse_md_file(filepath)
    local c = readfile(filepath)
    if not c then return nil end
    if c:sub(1, 3) ~= "---" then return nil end
    local _, end_pos = c:find("---", 5, true)
    if not end_pos then return nil end
    local frontmatter = c:sub(5, end_pos - 2)
    local body = c:sub(end_pos + 4)
    local meta = parse_frontmatter_v2(frontmatter)
    return meta, body
end

-- Check if posts table already has data
local count_check = io.popen("mariadb --socket=" .. DB_SOCKET .. " blogyou -N -e \"SELECT COUNT(*) FROM posts\" 2>/dev/null")
local post_count = count_check and count_check:read("*a") or "0"
if count_check then count_check:close() end

if tonumber(post_count) == 0 then
    io.stderr:write("[migrate] Importing posts from files...\n")
    local posts_handle = io.popen('ls "' .. blog_dir .. '/posts/*.md" 2>/dev/null')
    if posts_handle then
        local count = 0
        for file in posts_handle:lines() do
            local meta, body = parse_md_file(file)
            if meta then
                local slug = file:match("/([^/]+)%.md$") or ""
                local title = meta.title or slug
                local date_val = meta.date or "1970-01-01"
                local tags_json = cjson.encode(meta.tags or {})
                local cats_json = cjson.encode(meta.categories or {})
                local tags_en_json = cjson.encode(meta.tags_en or {})
                local cats_en_json = cjson.encode(meta.categories_en or {})
                local archived = (meta.archived == "true" or meta.archived == true) and "1" or "0"
                local now = tostring(os.time())

                local sql = "INSERT IGNORE INTO posts (slug, title, content, `date`, tags, categories, cover, archived, title_en, content_en, tags_en, categories_en, created_at, updated_at) VALUES ("
                sql = sql .. escape_sql(slug) .. ","
                sql = sql .. escape_sql(title) .. ","
                sql = sql .. escape_sql(body or "") .. ","
                sql = sql .. escape_sql(date_val) .. ","
                sql = sql .. escape_sql(tags_json) .. ","
                sql = sql .. escape_sql(cats_json) .. ","
                sql = sql .. escape_sql(meta.cover or "") .. ","
                sql = sql .. archived .. ","
                sql = sql .. escape_sql(meta.title_en or "") .. ","
                sql = sql .. escape_sql(meta.content_en or "") .. ","
                sql = sql .. escape_sql(tags_en_json) .. ","
                sql = sql .. escape_sql(cats_en_json) .. ","
                sql = sql .. now .. "," .. now .. ");\n"
                run(sql)
                count = count + 1
            end
        end
        posts_handle:close()
        io.stderr:write("[migrate] Imported " .. count .. " posts\n")
    end
end

-- Check if pages table already has data
count_check = io.popen("mariadb --socket=" .. DB_SOCKET .. " blogyou -N -e \"SELECT COUNT(*) FROM pages\" 2>/dev/null")
local page_count = count_check and count_check:read("*a") or "0"
if count_check then count_check:close() end

if tonumber(page_count) == 0 then
    io.stderr:write("[migrate] Importing pages from files...\n")
    local pages_handle2 = io.popen('ls "' .. blog_dir .. '/pages/*.md" 2>/dev/null')
    if pages_handle2 then
        local count = 0
        for file in pages_handle2:lines() do
            local meta, body = parse_md_file(file)
            if meta then
                local slug = file:match("/([^/]+)%.md$") or ""
                -- Try to load English content
                local en_file = blog_dir .. "/pages/" .. slug .. ".en.json"
                local en_content = ""
                local en_title = meta.title_en or ""
                local en_data = readfile(en_file)
                if en_data then
                    local ok_en, parsed_en = pcall(cjson.decode, en_data)
                    if ok_en and parsed_en then
                        en_content = parsed_en.content_en or ""
                        if parsed_en.title_en then en_title = parsed_en.title_en end
                    end
                end
                local now = tostring(os.time())
                local sql = "INSERT IGNORE INTO pages (slug, title, content, title_en, content_en, updated_at) VALUES ("
                sql = sql .. escape_sql(slug) .. ","
                sql = sql .. escape_sql(meta.title or slug) .. ","
                sql = sql .. escape_sql(body or "") .. ","
                sql = sql .. escape_sql(en_title) .. ","
                sql = sql .. escape_sql(en_content) .. ","
                sql = sql .. now .. ");\n"
                run(sql)
                count = count + 1
            end
        end
        pages_handle2:close()
        io.stderr:write("[migrate] Imported " .. count .. " pages\n")
    end
end

-- Check if friends table already has data
count_check = io.popen("mariadb --socket=" .. DB_SOCKET .. " blogyou -N -e \"SELECT COUNT(*) FROM friends\" 2>/dev/null")
local friend_count = count_check and count_check:read("*a") or "0"
if count_check then count_check:close() end

if tonumber(friend_count) == 0 then
    io.stderr:write("[migrate] Importing friends from files...\n")
    local friends_handle = io.popen('ls "' .. blog_dir .. '/friends/*.md" 2>/dev/null')
    if friends_handle then
        local count = 0
        for file in friends_handle:lines() do
            local meta, _ = parse_md_file(file)
            if meta then
                local now = tostring(os.time())
                local sql = "INSERT IGNORE INTO friends (title, descr, title_en, descr_en, avatar, url, sort_order, created_at) VALUES ("
                sql = sql .. escape_sql(meta.title or "Untitled") .. ","
                sql = sql .. escape_sql(meta.descr or "") .. ","
                sql = sql .. escape_sql(meta.title_en or "") .. ","
                sql = sql .. escape_sql(meta.descr_en or "") .. ","
                sql = sql .. escape_sql(meta.avatar or "") .. ","
                sql = sql .. escape_sql(meta.url or "#") .. ","
                sql = sql .. (meta.sort_order or "0") .. ","
                sql = sql .. now .. ");\n"
                run(sql)
                count = count + 1
            end
        end
        friends_handle:close()
        io.stderr:write("[migrate] Imported " .. count .. " friends\n")
    end
end

-- Check if talks table already has data
count_check = io.popen("mariadb --socket=" .. DB_SOCKET .. " blogyou -N -e \"SELECT COUNT(*) FROM talks\" 2>/dev/null")
local talk_count = count_check and count_check:read("*a") or "0"
if count_check then count_check:close() end

if tonumber(talk_count) == 0 then
    io.stderr:write("[migrate] Importing talks from files...\n")
    local talks_handle = io.popen('ls "' .. blog_dir .. '/talks/*.md" 2>/dev/null')
    if talks_handle then
        local count = 0
        for file in talks_handle:lines() do
            local meta, _ = parse_md_file(file)
            if meta and meta.content then
                local now = os.time()
                local create_time = tonumber(meta.id) or now
                local sql = "INSERT INTO talks (content, create_time) VALUES ("
                sql = sql .. escape_sql(meta.content) .. ","
                sql = sql .. create_time .. ");\n"
                run(sql)
                count = count + 1
            end
        end
        talks_handle:close()
        io.stderr:write("[migrate] Imported " .. count .. " talks\n")
    end
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
