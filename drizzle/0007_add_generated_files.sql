-- Document generation replaced the removed image feature. The old `images`
-- table (originally created via `db:push`, never through a migration) is
-- dropped; generated PDFs/DOCX/PPTX now live in `generated_files`, keyed by
-- id, owned through conversation_id, with the bytes base64-encoded in `data`.
DROP TABLE IF EXISTS images;

CREATE TABLE IF NOT EXISTS generated_files (
  id text PRIMARY KEY,
  conversation_id text NOT NULL,
  filename text NOT NULL,
  format text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  data text NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS generated_files_conversation_idx
  ON generated_files (conversation_id);
