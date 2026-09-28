-- Profile photo synced from the federated identity provider (Google/GitHub
-- via Firebase). Holds the provider's CDN URL; null = show the initial.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
