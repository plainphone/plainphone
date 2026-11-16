# SPDX-License-Identifier: Apache-2.0
# Plainphone server + parent PWA in one image.
#   docker build -t plainphone .
FROM node:24-slim AS build
WORKDIR /src
RUN npm install -g pnpm@12.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY server server
COPY web web
RUN pnpm --filter @plainphone/web build \
 && pnpm --filter @plainphone/server build \
 && pnpm --filter @plainphone/server deploy --prod --legacy /out \
 && cp -r server/dist server/drizzle /out/ \
 && cp -r web/dist /out/web

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
