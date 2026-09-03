FROM node:24-slim

# libreoffice: headless PPTX -> PDF conversion (artifacts/api-server/src/routes/presentations.ts)
# fontconfig + fonts-*: reasonable font coverage for that conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fontconfig \
    fonts-liberation \
    fonts-dejavu \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile

# The frontend build reads PORT/BASE_PATH at config-load time (see
# artifacts/slide-share/vite.config.ts) but neither value is baked into the
# served files for a static build, so any placeholder PORT is fine here.
RUN PORT=5173 BASE_PATH=/ pnpm --filter @workspace/slide-share run build
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
