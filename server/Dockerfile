# Build from the repository root:  docker build -f server/Dockerfile -t vitro-sync .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src/shared ./src/shared
COPY server ./server
RUN npm run server:build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN npm init -y >/dev/null && npm i pg@8 >/dev/null
COPY --from=build /app/server/dist/index.js ./index.mjs
USER node
EXPOSE 8787
CMD ["node", "index.mjs"]
