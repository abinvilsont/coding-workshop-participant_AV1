#!/usr/bin/env bash
# Copy backend/db (schema, seed, migrations) into the api-service Lambda package,
# which is zipped from backend/api-service only. The Lambda's init_db / migrate
# tasks run these copies on AWS, where the database can't be reached directly.
# A test (tests/unit/test_packaged_sql.py) fails if the copies drift.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/backend/db"
DEST="$ROOT/backend/api-service/sql"
rm -rf "$DEST"
mkdir -p "$DEST/migrations"
cp "$SRC/schema.sql" "$SRC/seed.sql" "$DEST/"
cp "$SRC"/migrations/*.sql "$DEST/migrations/"
echo "Synced backend/db -> backend/api-service/sql ($(ls "$DEST/migrations" | wc -l) migrations)"
