# --- deps stage --------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Make npm survive slow / flaky networks instead of going silent.
# fetch-timeout = ms before npm gives up on a single registry request.
# fetch-retries with exp backoff handles transient registry blips.
RUN npm config set fetch-timeout 600000 \
 && npm config set fetch-retries 8 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set registry https://registry.npmjs.org/

COPY package.json package-lock.json* ./

# `--loglevel=http` prints each URL npm fetches — so you can see if it's making
# progress or actually stuck on a specific package. Far better than the silent
# default that makes "downloading" look identical to "hung".
# `--prefer-online` skips the corrupted-cache code path that sometimes wedges.
RUN npm install --no-audit --no-fund --prefer-online --loglevel=http

# --- build stage -------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_BASE=/api
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN npm run build

# --- runner stage ------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# node:alpine ships with a non-root `node` user (UID 1000). Use it.
# --chown on COPY lets the runtime user read/execute the standalone bundle
# without an extra chown layer.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node

EXPOSE 3000
CMD ["node", "server.js"]
