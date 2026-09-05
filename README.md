# Beacon

A free AI study-buddy app you own end to end — chat instantly as a guest, or
sign up to save your conversation history. Built with Next.js, TypeScript,
Tailwind, and Groq for fast open-model inference.

Originally scaffolded with local SQLite for zero-setup local development,
now migrated to **Postgres (via Neon)** so it can deploy on Vercel, where
serverless functions have no persistent local filesystem.

## What it does

- Guest chat, no login required
- Sign up / log in, and your conversations are saved and listed in a sidebar
- 3 model modes (Zap / Sage / Forge) via Groq
- Language toggle: English, Roman Urdu, Urdu script
- Streaming responses (tokens appear as they're generated)

## Tech stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Postgres via Neon's serverless driver (`@neondatabase/serverless`) + Drizzle ORM
- JWT session cookies (`jose`) + `bcryptjs` for password hashing
- Groq's OpenAI-compatible chat completions API, streamed

## Getting started (local development)

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Get a free Groq API key** at https://console.groq.com

3. **Get a free Postgres database** at https://neon.tech — sign up, create a
   project, and copy the connection string it gives you (starts with
   `postgresql://`).

4. **Create your env file**

   ```bash
   cp .env.local.example .env.local
   ```

   Then fill in `GROQ_API_KEY`, `JWT_SECRET`, and `DATABASE_URL` (your Neon
   connection string).

5. **Create the database tables**

   Open the SQL editor in your Neon project dashboard and paste in the
   contents of `drizzle/0000_init.sql`, then run it. This only needs to be
   done once. (Alternatively, run `npm run db:push` locally if you have
   `DATABASE_URL` set in your shell.)

6. **Run it**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Deploying to Vercel

1. Push this project to a GitHub repo.
2. Go to https://vercel.com/new and import the repo.
3. In the project's Environment Variables settings, add `GROQ_API_KEY`,
   `JWT_SECRET`, and `DATABASE_URL` (same values as your `.env.local`).
4. Deploy. Vercel auto-detects Next.js — no build configuration needed.
5. Make sure you've already run `drizzle/0000_init.sql` against your Neon
   database (step 5 above) — Vercel's deploy doesn't do this for you.

Your Neon database and Vercel deployment are independent of your local dev
setup, so the same database can be shared between local development and
production, or you can create a second free Neon project for production only.

## Project structure

```
src/
  app/
    page.tsx                 - guest landing/chat page
    login/, signup/          - auth screens
    dashboard/page.tsx       - logged-in chat with saved conversation sidebar
    api/
      chat/route.ts          - streams responses from Groq, saves history if logged in
      auth/*                 - signup, login, logout, current-user routes
      conversations/*        - list + fetch saved conversations
  components/                - ChatWindow, Sidebar, ModelSelector, LanguageToggle, MessageBubble
  lib/
    db.ts, schema.ts         - Postgres (Neon) connection + Drizzle schema
    auth.ts                  - password hashing + JWT session cookies
    models.ts                - maps friendly model names to Groq model IDs
    i18n.ts                  - UI translation strings
drizzle/
  0000_init.sql              - run this once against your Neon database to create tables
```

## Things you'll likely want to change as you make it "yours"

- **Models**: edit `src/lib/models.ts`. Groq renames/retires model IDs over
  time — check https://console.groq.com/docs/models for current names.
- **Branding**: `src/app/globals.css` and `tailwind.config.ts` hold the color
  palette (deep ink-blue + amber "desk lamp" accent) and fonts.
- **Email verification**: this starter skips it to keep setup simple. To add
  it, add a `verified` column to `users`, send a verification email via
  Resend on signup, and block login until it's confirmed.
- **Rate limiting**: there's none yet. For a public deployment, add a service
  like Upstash Redis to rate-limit `/api/chat` and `/api/auth/*` so one user
  can't hammer your Groq quota or your Neon compute-hour allowance.
- **Connection pooling at scale**: Neon's serverless HTTP driver (used here)
  is well-suited to Vercel's serverless functions as-is. If you outgrow the
  free tier or move to a long-running server instead of serverless, consider
  Neon's pooled connection string with `drizzle-orm/node-postgres` instead.

## License

MIT — do whatever you want with it.
