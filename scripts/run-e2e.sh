#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  LOCAL_COMPOSE_ENV=".env"
else
  LOCAL_COMPOSE_ENV=".env.example"
fi
set -a
# shellcheck disable=SC1091
source .env.e2e
set +a

restore_local_services() {
  env \
    -u APP_ORIGIN \
    -u S3_BUCKET \
    -u S3_ACCESS_KEY_ID \
    -u S3_SECRET_ACCESS_KEY \
    -u POSTGRES_USER \
    -u POSTGRES_PASSWORD \
    -u POSTGRES_DB \
    -u POSTGRES_PORT \
    docker compose --env-file "$LOCAL_COMPOSE_ENV" up -d >/dev/null 2>&1 || true
}
trap restore_local_services EXIT

docker compose up -d

for _ in {1..30}; do
  if docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null

if ! docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$E2E_DATABASE'" | grep -q 1; then
  docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$E2E_DATABASE"
fi

docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$E2E_DATABASE" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

docker compose run --rm --entrypoint /bin/sh minio-init -c '
  until /usr/bin/mc alias set local http://minio:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"; do sleep 1; done
  /usr/bin/mc mb --ignore-existing "local/$S3_BUCKET"
  /usr/bin/mc rm --recursive --force "local/$S3_BUCKET" >/dev/null 2>&1 || true
  /usr/bin/mc anonymous set none "local/$S3_BUCKET"
'

npx prisma migrate deploy
npm run build
npx playwright test "$@"
