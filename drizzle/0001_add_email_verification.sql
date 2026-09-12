-- Migration: add email verification (run once against your database).
-- New deployments that run 0000_init.sql already get this column.

ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at BIGINT;
