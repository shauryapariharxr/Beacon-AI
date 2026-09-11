import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Add your Supabase Postgres connection string to .env.local (or Vercel's project environment variables)."
  );
}

// Serverless-specific tuning:
// - `prepare: false` is required for Supabase's transaction-mode pooler
//   (pgbouncer/Supavisor), which doesn't support prepared statements.
// - `max: 1` caps each serverless function instance to a single database
//   connection. Without this, every cold start can open a fresh batch of
//   connections, and on Supabase's free tier (60 connections total) that
//   adds up fast — leading to exactly the symptom of "works sometimes,
//   silently fails other times" once you have more than a handful of
//   concurrent requests.
// - `idle_timeout` and `connect_timeout` make failures fail fast and
//   loudly instead of hanging, and free up the connection slot quickly
//   once a request is done with it.
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
});
export const db = drizzle(client, { schema });
