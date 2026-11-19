-- =====================================================================
-- 002: merge duplicate incidents
-- Additive and safe to re-run on an existing database (no data loss):
--   psql -h <host> -U <user> -d <db> -f backend/db/migrations/002_incident_merge.sql
-- schema.sql already contains these changes for fresh databases.
-- =====================================================================

BEGIN;

ALTER TABLE incidents
    ADD COLUMN IF NOT EXISTS merged_into_id BIGINT REFERENCES incidents (id) ON DELETE SET NULL;

DO $$ BEGIN
    ALTER TABLE incidents ADD CONSTRAINT incidents_not_merged_into_self_chk
        CHECK (merged_into_id IS NULL OR merged_into_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE incidents ADD CONSTRAINT incidents_merged_is_cancelled_chk
        CHECK (merged_into_id IS NULL OR status = 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS incidents_merged_into_idx
    ON incidents (merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS incident_followers (
    incident_id  BIGINT      NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    user_id      BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    added_by     BIGINT      REFERENCES users (id) ON DELETE SET NULL,
    added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (incident_id, user_id)
);
CREATE INDEX IF NOT EXISTS incident_followers_user_idx ON incident_followers (user_id);

COMMIT;
