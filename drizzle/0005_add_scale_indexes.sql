-- Production-scale indexes + referential integrity.
--
-- Before this migration the ONLY indexes in the database were the primary
-- keys plus `users_email_key`. That means both hot read paths were full table
-- scans on every request:
--
--   * loading a conversation's history  -> seq scan of `messages`
--   * listing one user's conversations  -> seq scan of `conversations`
--
-- which is invisible at 100 messages and fatal at 1,000,000: every page load
-- costs O(total rows). These indexes make both paths O(rows returned).
--
-- (CREATEd without CONCURRENTLY: Supabase's transaction pooler on port 6543
-- cannot run CREATE INDEX CONCURRENTLY outside an explicit transaction, and
-- the tables are still small. On a large live table, run each statement
-- directly in the Supabase SQL editor with CONCURRENTLY instead.)

-- Conversation list: `where user_id = $1 order by created_at desc`.
CREATE INDEX IF NOT EXISTS conversations_user_created_idx
  ON conversations (user_id, created_at DESC);

-- Message history + "delete this conversation": `where conversation_id = $1
-- order by created_at`. Also the driving index for the admin drill-down.
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at);

-- Admin dashboard windows: `created_at > $1 [and role = 'user']`, plus the
-- per-day activity counts. Role first would defeat the range scan, so
-- created_at leads.
CREATE INDEX IF NOT EXISTS messages_created_idx
  ON messages (created_at DESC);

-- Admin "new users" counters/sorting.
CREATE INDEX IF NOT EXISTS users_created_idx
  ON users (created_at DESC);

-- Admin memory counters + future memory listings.
CREATE INDEX IF NOT EXISTS memories_user_created_idx
  ON memories (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Referential integrity.
--
-- Nothing previously linked these tables, so deleting a user (or a document)
-- left its conversations, messages and chunks behind forever, owned by a
-- user id that no longer exists. ON DELETE CASCADE makes cleanup automatic.
-- `NOT VALID` + `VALIDATE` avoids holding a long write lock on big tables;
-- both are instant here.
-- ---------------------------------------------------------------------------

-- Each FK is added NOT VALID (no long lock on a big table) and then
-- validated. A constraint whose table still holds rows orphaned before this
-- migration is left NOT VALID with a notice: it is enforced for every new
-- row, it simply isn't re-checked against pre-existing history. Nothing in
-- the app can reach those orphan rows anyway (their owner is gone).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_user_fk') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE conversations VALIDATE CONSTRAINT conversations_user_fk;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'conversations_user_fk has pre-existing orphans; left NOT VALID';
  END;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_fk') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_conversation_fk
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE messages VALIDATE CONSTRAINT messages_conversation_fk;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'messages_conversation_fk has pre-existing orphans; left NOT VALID';
  END;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_user_fk') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE documents VALIDATE CONSTRAINT documents_user_fk;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'documents_user_fk has pre-existing orphans; left NOT VALID';
  END;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_chunks_document_fk') THEN
    ALTER TABLE document_chunks ADD CONSTRAINT document_chunks_document_fk
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE document_chunks VALIDATE CONSTRAINT document_chunks_document_fk;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'document_chunks_document_fk has pre-existing orphans; left NOT VALID';
  END;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memories_user_fk') THEN
    ALTER TABLE memories ADD CONSTRAINT memories_user_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE memories VALIDATE CONSTRAINT memories_user_fk;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'memories_user_fk has pre-existing orphans; left NOT VALID';
  END;
END $$;
