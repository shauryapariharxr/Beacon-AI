-- RAG: documents (uploads), document_chunks (embeddings), memories
-- (cross-conversation long-term memory). Requires the `vector` extension
-- (enabled via `CREATE EXTENSION IF NOT EXISTS vector` — Supabase ships it).

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  -- processing | ready | error
  status TEXT NOT NULL DEFAULT 'ready',
  error TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_user_idx ON documents(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  -- Mistral mistral-embed output dimension
  embedding vector(1024) NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS document_chunks_doc_idx ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS document_chunks_user_idx ON document_chunks(user_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- Conversation the exchange came from (NULL for backfilled memories;
  -- unique so one memory per conversation turn-set).
  conversation_id TEXT UNIQUE,
  source_user TEXT NOT NULL,
  source_assistant TEXT NOT NULL,
  summary TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_user_idx ON memories(user_id);

-- Note: no ANN (HNSW/IVFFlat) index yet — per-user chunk counts are tiny,
-- so exact sequential scan is both fastest and 100% accurate. Add an HNSW
-- index if a user ever accumulates >~50k chunks.
