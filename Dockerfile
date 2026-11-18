# syntax=docker/dockerfile:1
# Card sort tool — production image. See README.md ("Run with Docker").

# ---- deps: install all dependencies
# (better-sqlite3 ships prebuilt binaries for linux x64/arm64, so no compiler toolchain is needed)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: better-sqlite3 uses its bundled prebuilds; no package here needs install scripts.
RUN npm ci --ignore-scripts

# ---- build: compile the Next.js standalone server
FROM deps AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
COPY . .
RUN npm run build

# ---- run: minimal runtime image
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/cardsort.db \
    AUTO_MIGRATE=1

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# For `node scripts/hash-password.mjs` inside the container.
COPY --from=build --chown=node:node /app/scripts/hash-password.mjs ./scripts/hash-password.mjs
COPY --from=build --chown=node:node /app/node_modules/bcryptjs ./node_modules/bcryptjs

# SQLite database lives on a volume.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/admin/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
