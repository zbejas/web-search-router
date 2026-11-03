FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN bun run build

FROM oven/bun:1-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS release
WORKDIR /app
ARG VERSION=0.1.2
LABEL org.opencontainers.image.title="Web Search Router" \
      org.opencontainers.image.description="Priority routing, automatic failover, and self-healing health for web search providers." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.source="https://github.com/zbejas/web-search-router"
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json LICENSE ./
COPY src ./src
COPY public ./public
COPY --from=build /app/dist ./dist
RUN mkdir -p data && chmod 700 data && chown -R bun:bun /app
USER bun
EXPOSE 8123
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8123/_router/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/index.tsx", "--port", "8123", "--host", "0.0.0.0"]
