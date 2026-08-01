-- Migration 002: add quiet-hours / maintenance-window columns to alert_configs (issue #325)
--
-- Allows operators to suppress alert delivery during a known maintenance window
-- (e.g. a planned deployment or nightly backup) without deleting and re-creating
-- the alert config.
--
-- NULL in all three columns means "no quiet window" — existing rows are unaffected.
-- HH:MM text format (24-hour) keeps storage simple and portable.
--
-- On databases initialised from schema.sql 002+ these columns already exist;
-- the Migrator handles the "duplicate column name" error gracefully and still
-- records this migration as applied (see src/db/migrator.ts).

ALTER TABLE alert_configs ADD COLUMN quiet_hours_start    TEXT;
ALTER TABLE alert_configs ADD COLUMN quiet_hours_end      TEXT;
ALTER TABLE alert_configs ADD COLUMN quiet_hours_timezone TEXT;
