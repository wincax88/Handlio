# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
ARG SOURCE_REPOSITORY=https://github.com/wincax88/Handlio
ARG SOURCE_REVISION=main
ENV VITE_SOURCE_REPOSITORY=$SOURCE_REPOSITORY VITE_SOURCE_REVISION=$SOURCE_REVISION
COPY index.html tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts ./
COPY src ./src
COPY shared ./shared
COPY server ./server
COPY public ./public
COPY LICENSE ./LICENSE
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-noto-cjk fonts-liberation tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data \
    CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/LICENSE ./LICENSE
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "server/index.ts"]
