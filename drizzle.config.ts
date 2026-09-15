import type { Config } from "drizzle-kit";

// drizzle-kit only auto-loads `.env`, but this project keeps secrets in
// `.env.local` (Next.js convention) — load it explicitly so `db:studio`
// and `db:push` work out of the box.
process.loadEnvFile?.(".env.local");

export default {
  schema: "./src/lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
