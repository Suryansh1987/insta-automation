FROM node:20-bookworm-slim AS base

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY server/package*.json ./server/
COPY packages/shared/package*.json ./packages/shared/

RUN npm ci

COPY tsconfig.base.json ./
COPY server ./server
COPY packages/shared ./packages/shared

RUN npm run build --workspace=@insta-saas/shared
RUN npm install
RUN npm run generate --workspace=server
RUN npm run build --workspace=server

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]