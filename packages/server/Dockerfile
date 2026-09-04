# Build context is the repository root (see docker-compose.yml).
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
RUN npm ci --workspace=@lore/server --include-workspace-root=false
COPY packages/server/tsconfig.json packages/server/nest-cli.json packages/server/
COPY packages/server/src packages/server/src
RUN npm run build --workspace=@lore/server && npm prune --omit=dev --workspace=@lore/server

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/server/dist ./dist
COPY packages/server/package.json ./
COPY seed /app/seed
RUN printf '#!/bin/sh\nexec node /app/dist/admin.js "$@"\n' > /usr/local/bin/lore-admin && chmod +x /usr/local/bin/lore-admin
EXPOSE 8080
CMD ["node", "dist/main.js"]
