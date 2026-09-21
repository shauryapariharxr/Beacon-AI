-- Add Firebase linkage to users (hybrid Firebase auth migration).
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
