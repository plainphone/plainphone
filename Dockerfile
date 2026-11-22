# SPDX-License-Identifier: Apache-2.0
# Plainphone server + parent PWA in one image.
#   docker build -t plainphone .
FROM node:24-slim AS dependencies
WORKDIR /src
RUN npm install -g pnpm@12.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY web/package.json web/
# The workspace packages the PWA imports. The parent app and packages/crypto stay out.
COPY packages/i18n/package.json packages/i18n/
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile

# Keep the production dependency layer reusable across source-only changes.
FROM dependencies AS production-dependencies
RUN pnpm --filter @plainphone/server deploy --prod --legacy /out

FROM dependencies AS build
COPY server server
COPY web web
COPY packages/i18n packages/i18n
COPY packages/shared packages/shared
COPY packages/api-client packages/api-client
RUN pnpm -r build \
 && node server/precompress-pwa.mjs web/dist/assets

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=production-dependencies /out/package.json ./
COPY --from=production-dependencies /out/node_modules ./node_modules
COPY --from=build /src/server/dist ./dist
COPY --from=build /src/server/drizzle ./drizzle
COPY --from=build /src/server/catalog ./catalog
COPY --from=build /src/web/dist ./web
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
