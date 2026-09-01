# Blog Material You — Docker image
# OpenResty + embedded MariaDB (optional: point at an external DB via BMY_DB_HOST)

# alpine:3.23 (supported until 2027-11) — 3.20 is EOL and its package repos
# are frozen/being phased out, which broke the build.
FROM alpine:3.23

LABEL description="Blog Material You — standalone blog system (OpenResty + MariaDB, S3/MinIO image hosting)"
LABEL maintainer="Hermes-bot"

# Install dependencies.
# NOTE: no explicit --repository flag — the base image already enables the
# main and community repos over HTTPS in /etc/apk/repositories. The previous
# hard-coded http://dl-cdn... URL was redundant, insecure, and a build
# failure point on networks that block/redirect plain HTTP.
RUN apk add --no-cache \
    openresty \
    mariadb \
    mariadb-client \
    mariadb-common \
    mariadb-server-utils \
    tzdata \
    curl

# Install MinIO Client (mc) — used by the imghost module for S3 uploads
# (MinIO, AWS S3 and any S3-compatible object store).
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
RUN curl -fsSL -o /usr/local/bin/mc \
        "https://dl.min.io/client/mc/release/linux-amd64/archive/mc.${MC_VERSION}" && \
    chmod +x /usr/local/bin/mc && \
    mc --version

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

# Initialize MariaDB system tables (data dir can be overridden by volume)
RUN mkdir -p /app/data/mysql && \
    mariadb-install-db --datadir=/app/data/mysql --user=root --skip-test-db 2>/dev/null && \
    echo "MariaDB system tables initialized"

# Make entrypoint executable
RUN chmod +x /app/docker/docker-entrypoint.sh

# Fix MariaDB data dir ownership for mysql user
RUN chown -R mysql:mysql /app/data/mysql

# Make all Lua files readable by nginx worker
RUN find /app/backend/lua -name '*.lua' -exec chmod 644 {} \;

# Install ImageMagick for avatar resize
RUN apk add --no-cache imagemagick

EXPOSE 30999 31000

ENTRYPOINT ["/app/docker/docker-entrypoint.sh"]
