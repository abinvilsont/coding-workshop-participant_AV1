-- =====================================================================
-- 004: escalation requests from other employees
-- An employee who finds that their problem is already reported can ask for
-- that incident to be escalated; they become a follower, and this records when.
-- Additive and safe to re-run on an existing database (no data loss):
--   psql -h <host> -U <user> -d <db> -f backend/db/migrations/004_escalation_requests.sql
-- schema.sql already contains this change for fresh databases.
-- =====================================================================

ALTER TABLE incident_followers ADD COLUMN IF NOT EXISTS escalation_requested_at TIMESTAMPTZ;
