-- =====================================================================
-- 006: an employee's (or admin's) usual building, set by a Facility Admin
-- on the People page. The report form starts on it. Additive and safe to
-- re-run:
--   psql -h <host> -U <user> -d <db> -f backend/db/migrations/006_user_home_building.sql
-- schema.sql already contains this column for fresh databases.
-- =====================================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS home_building_id BIGINT REFERENCES buildings (id) ON DELETE SET NULL;
