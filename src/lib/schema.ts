import { pgTable, text, bigint } from "drizzle-orm/pg-core";

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
