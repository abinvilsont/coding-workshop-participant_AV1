-- =====================================================================
-- 005: app secrets (e.g. the JWT signing key the init_db / migrate task
-- generates on AWS). Additive and safe to re-run:
--   psql -h <host> -U <user> -d <db> -f backend/db/migrations/005_app_secrets.sql
-- schema.sql already contains this table for fresh databases.
-- =====================================================================

CREATE TABLE IF NOT EXISTS app_secrets (
    name        VARCHAR(50) PRIMARY KEY,
    value       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
