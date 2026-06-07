# Blog Material You — Docker image
# Single container: OpenResty + MariaDB

FROM alpine:3.20

LABEL description="Blog Material You — standalone blog system (OpenResty + MariaDB)"
LABEL maintainer="Hermes-bot"

# Install dependencies
RUN apk add --no-cache --repository=http://dl-cdn.alpinelinux.org/alpine/v3.20/community/ \
    openresty \
    mariadb \
    mariadb-client \
    mariadb-common \
    tzdata \
    curl

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

# Initialize MariaDB system tables (data dir can be overridden by volume)
RUN mariadb-install-db --datadir=/app/blog/data/mysql --user=root --skip-test-db 2>/dev/null && \
    echo "MariaDB system tables initialized"

# Make entrypoint executable
RUN chmod +x /app/docker/docker-entrypoint.sh

EXPOSE 30999 31000

ENTRYPOINT ["/app/docker/docker-entrypoint.sh"]
