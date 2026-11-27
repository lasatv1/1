#!/bin/sh
# Runs once, as the database superuser, when the Postgres volume is first created.
# Creates PostGIS and a least-privilege application role that owns only the `cta` schema.
set -eu
APP_PASSWORD="$(cat /run/secrets/db_app_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_pw="$APP_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE ROLE cta_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA cta AUTHORIZATION cta_app;
ALTER ROLE cta_app SET search_path = cta, public;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE :"DBNAME" FROM PUBLIC;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "GRANT CONNECT ON DATABASE \"$POSTGRES_DB\" TO cta_app;"
