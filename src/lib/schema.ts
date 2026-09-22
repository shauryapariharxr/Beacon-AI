import { pgTable, text, bigint, integer, customType } from "drizzle-orm/pg-core";

// pgvector column type. Drizzle 0.33 predates the built-in `vector` helper
// in some setups, so define it explicitly — SQL side it's just `vector(1024)`.
// toDriver serializes JS arrays into pgvector's '[v1,v2,...]' text format;
// without it the driver sends a bracket-less string pgvector rejects.
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Signup requires a name (enforced in the API); the column stays
  // nullable as a safety net for any data imported outside the app.
  name: text("name"),
  // Set when the account was created through / linked to Firebase Auth
  // (Google sign-in or Firebase email/password). Null for legacy accounts.
  firebaseUid: text("firebase_uid"),
  // Kept for schema stability; new accounts are verified immediately on
  // signup (no email-verification step).
  verifiedAt: bigint("verified_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull().default("New chat"),
  model: text("model").notNull().default("flash"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

// ---------- RAG ----------

export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
  chunkCount: integer("chunk_count").notNull().default(0),
  // processing | ready | error
  status: text("status").notNull().default("ready"),
  error: text("error"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const documentChunks = pgTable("document_chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull(),
  userId: text("user_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const memories = pgTable("memories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  // Conversation the exchange came from (unique: one memory per turn-set).
  conversationId: text("conversation_id"),
  sourceUser: text("source_user").notNull(),
  sourceAssistant: text("source_assistant").notNull(),
  summary: text("summary").notNull(),
  embedding: vector("embedding").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
