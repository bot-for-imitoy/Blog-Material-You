# Blog Material You — Node.js image
#
# A single self-contained container: no database server, no nginx, no Python.
# Content is Markdown on disk and all runtime state lives under /app/blog/data.
FROM node:24-alpine

LABEL description="Blog Material You — Node.js + TypeScript SSR blog with local Markdown storage"
LABEL maintainer="Hermes-bot"

WORKDIR /app

# Install dependencies first so the layer is cached across source changes.
# sharp ships prebuilt musl binaries, so no compiler is needed.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Application source.
COPY . .

# Vendor mdui / KaTeX / highlight.js from node_modules into the static tree so
# the image never needs a public CDN at runtime.
RUN node scripts/sync-assets.mjs

# Runtime directories. The container runs as the unprivileged `node` user, so
# the writable paths must be owned by it. `image-cache` holds the resized image
# variants rendered by `GET /media`; it is disposable and can be deleted at any
# time.
RUN mkdir -p /app/blog/data/comments /app/blog/data/sessions /app/blog/data/image-cache \
             /app/blog/public/avatars /app/blog/public/uploads \
    && chown -R node:node /app/blog/data /app/blog/public/avatars /app/blog/public/uploads

# The admin console can edit site settings, which are written back into
# `_config.yml`. Without this the save would fail with EACCES for the `node`
# user. Mount the file read-only if you would rather manage it outside the
# container — the settings page then reports a save error instead of silently
# doing nothing.
RUN chown node:node /app/_config.yml

USER node

ENV NODE_ENV=production \
    BMY_BLOG_DIR=/app/blog \
    BMY_PORT=30999 \
    BMY_HOST=0.0.0.0

EXPOSE 30999

# Persist credentials, comments, visitor data and settings.
VOLUME ["/app/blog/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.BMY_PORT||30999)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.ts"]
