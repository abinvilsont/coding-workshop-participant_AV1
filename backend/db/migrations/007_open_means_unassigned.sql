-- =====================================================================
-- 007: an Open incident has no engineer. Additive and safe to re-run:
--   psql -h <host> -U <user> -d <db> -f backend/db/migrations/007_open_means_unassigned.sql
-- schema.sql already contains this constraint for fresh databases.
--
-- Before this, an admin moving an incident back to Open (or reopening a
-- cancelled one) kept its engineer: the engineer saw it in their list but
-- had no actions, and it didn't count toward their workload. The API now
-- clears the engineer on that move; this clears incidents already left
-- that way, then adds the database rule. History records it as "System".
-- =====================================================================


UPDATE incidents
SET assigned_engineer_id = NULL, assigned_by = NULL, assigned_at = NULL
WHERE status = 'open' AND assigned_engineer_id IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incidents_open_unassigned_chk') THEN
        ALTER TABLE incidents ADD CONSTRAINT incidents_open_unassigned_chk
            CHECK (status <> 'open' OR assigned_engineer_id IS NULL);
    END IF;
END $$;

