-- Run once against any database created before the `name` column was added.
-- Fresh databases don't need this: 0000_init.sql already includes the column.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
