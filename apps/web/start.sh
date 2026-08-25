#!/bin/sh
# Container entrypoint: apply the SQL schema (idempotent) to the mounted
# SQLite volume, then run the API. cmd/migrate globs internal/db/schema/*.sql
# relative to the working directory, which is /app in the image.
set -e
cd /app
/app/migrate
exec /app/web-api "$@"
