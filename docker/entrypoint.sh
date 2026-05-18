#!/bin/sh
set -e

echo "[docker] running prisma migrate deploy..."
npm run migrate:deploy --workspace=server

echo "[docker] starting api..."
exec npm run start --workspace=server