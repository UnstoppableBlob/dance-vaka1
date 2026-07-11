#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  set -a
  # shellcheck disable=SC1091
  source .env.example
  set +a
fi

CHECK_DATABASE="dance_academy_release_check_$$"
CHECK_DATABASE_URL="${DATABASE_URL%/*}/${CHECK_DATABASE}?schema=public"

cleanup() {
  docker compose exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$CHECK_DATABASE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose up -d postgres
for _ in {1..30}; do
  if docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$CHECK_DATABASE"

DATABASE_URL="$CHECK_DATABASE_URL" NODE_ENV=production npx prisma migrate deploy

MIGRATION_COUNT="$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$CHECK_DATABASE" -tAc 'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')"
EXPECTED_MIGRATION_COUNT="$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [[ "$MIGRATION_COUNT" != "$EXPECTED_MIGRATION_COUNT" ]]; then
  echo "Expected $EXPECTED_MIGRATION_COUNT completed migrations, found $MIGRATION_COUNT." >&2
  exit 1
fi
npx prisma generate >/dev/null
for _ in 1 2; do
  DATABASE_URL="$CHECK_DATABASE_URL" NODE_ENV=development SEED_DEMO_PASSWORD="ReleaseCheck123" npx tsx scripts/seed.ts >/dev/null
done

SEED_COUNTS="$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$CHECK_DATABASE" -tAc \
  "SELECT (SELECT COUNT(*) FROM \"User\" WHERE \"usernameNormalized\" LIKE 'demo_%') || ',' || (SELECT COUNT(*) FROM \"DanceClass\" WHERE \"nameNormalized\" = 'demo beginner class') || ',' || (SELECT COUNT(*) FROM \"ClassMembership\") || ',' || (SELECT COUNT(*) FROM \"ClassInvitation\")")"
if [[ "$SEED_COUNTS" != "3,1,1,1" ]]; then
  echo "Unexpected idempotent seed counts: $SEED_COUNTS." >&2
  exit 1
fi
echo "Clean database verification passed ($MIGRATION_COUNT migrations; seed counts $SEED_COUNTS)."
