# The sync server's image. Published for every release as
# ghcr.io/pad-mac/vitro-sync (amd64 and arm64) by .github/workflows/build.yml;
# docker-compose.yml runs that image and keeps it up to date.
# Build it yourself from the repository root:  docker build -f server/Dockerfile -t vitro-sync .

# The bundle is plain JavaScript: built once, on the machine that builds.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src/shared ./src/shared
COPY server ./server
RUN npm run server:build

FROM node:22-alpine
ARG VITRO_VERSION=dev
WORKDIR /app
ENV NODE_ENV=production VITRO_VERSION=$VITRO_VERSION
RUN npm init -y >/dev/null && npm i pg@8 >/dev/null
COPY --from=build /app/server/dist/index.js ./index.mjs
USER node
EXPOSE 8787
CMD ["node", "index.mjs"]
