# syntax=docker/dockerfile:1.7

FROM node:22-slim AS builder
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY server ./server
COPY client ./client
RUN npm run build
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production \
    PORT=8080 \
    BABYONE_DB=/data/data.db

COPY --from=builder /app/package.json /app/package-lock.json /app/
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/server/package.json /app/server/package.json
COPY --from=builder /app/server/dist /app/server/dist
COPY --from=builder /app/client/package.json /app/client/package.json
COPY --from=builder /app/client/dist /app/client/dist

EXPOSE 8080
CMD ["node", "dist/index.js"]
