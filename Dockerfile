# Blog Material You — Docker image
# OpenResty only: the image does NOT bundle a database server — connect to an
# external MariaDB/MySQL (e.g. the one on the Docker host) via BMY_DB_URL or
# BMY_DB_HOST. mariadb-client is kept for automatic schema init/migration.

# alpine:3.23 (supported until 2027-11) — 3.20 is EOL and its package repos
# are frozen/being phased out, which broke the build.
FROM alpine:3.23

LABEL description="Blog Material You — standalone blog system (OpenResty + external MariaDB, S3/MinIO image hosting)"
LABEL maintainer="Hermes-bot"

# Install dependencies.
# NOTE: no explicit --repository flag — the base image already enables the
# main and community repos over HTTPS in /etc/apk/repositories. The previous
# hard-coded http://dl-cdn... URL was redundant, insecure, and a build
# failure point on networks that block/redirect plain HTTP.
# NOTE: only the MariaDB CLIENT is installed (used by the entrypoint and the
# Lua db module to initialize/migrate the schema on the external database).
# The MariaDB server is intentionally NOT included — the container always
# connects to a database provided by the host.
RUN apk add --no-cache \
    openresty \
    mariadb-client \
    tzdata \
    curl

# Python + boto3 — used by the imghost module for S3 uploads (MinIO, AWS S3
# and any S3-compatible store). Supports TLS with custom CA and mutual TLS
# (client certificates), which the MinIO Client (mc) cannot do.
RUN apk add --no-cache python3 py3-boto3

# Create project directories
WORKDIR /app

# Copy everything
COPY . .

# Create required runtime directories
RUN mkdir -p \
    backend/logs \
    backend/tmp/body \
    backend/tmp/proxy \
    backend/tmp/fastcgi \
    backend/tmp/uwsgi \
    backend/tmp/scgi

# Avatar upload directory — nginx worker must be able to write here
RUN mkdir -p blog/public/avatars && \
    chown :nginx blog/public/avatars && \
    chmod 775 blog/public/avatars

# S3 helper script must be readable/executable
RUN chmod 755 /app/backend/s3.py

# Make entrypoint executable
RUN chmod +x /app/docker/docker-entrypoint.sh

# Make all Lua files readable by nginx worker
RUN find /app/backend/lua -name '*.lua' -exec chmod 644 {} \;

# nginx workers drop container-level supplementary groups when switching to
# the nginx user (initgroups), so host-mounted TLS certs owned by the host's
# ssl-cert group (gid 963 on the deployment host) must be readable through an
# in-image group membership. If your host uses a different gid for the certs'
# group, adjust 963 accordingly.
RUN addgroup -S -g 963 ssl-cert && addgroup nginx ssl-cert

# Install ImageMagick for avatar resize
RUN apk add --no-cache imagemagick

EXPOSE 30999 31000

ENTRYPOINT ["/app/docker/docker-entrypoint.sh"]
