-- =====================================================================
-- 003: engineer reviews
-- Additive and safe to re-run on an existing database (no data loss):
--   psql -h <host> -U <user> -d <db> -f backend/db/migrations/003_engineer_reviews.sql
-- schema.sql already contains these changes for fresh databases.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS engineer_reviews (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incident_id  BIGINT      NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
    engineer_id  BIGINT      NOT NULL REFERENCES engineer_profiles (user_id) ON DELETE CASCADE,
    reviewer_id  BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    rating       SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT        CHECK (comment IS NULL OR length(comment) <= 2000),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT engineer_reviews_one_per_reviewer_uq UNIQUE (incident_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS engineer_reviews_engineer_idx ON engineer_reviews (engineer_id, created_at DESC);

DROP TRIGGER IF EXISTS engineer_reviews_updated_at ON engineer_reviews;
CREATE TRIGGER engineer_reviews_updated_at BEFORE UPDATE ON engineer_reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
