import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add your Supabase Postgres connection string to .env.local (or Vercel's project environment variables)."
  );
}

// `prepare: false` is required for Supabase's connection pooler (pgbouncer),
// which doesn't support prepared statements. Harmless if you're not pooling.
const client = postgres(process.env.DATABASE_URL, { prepare: false });
export const db = drizzle(client, { schema });
