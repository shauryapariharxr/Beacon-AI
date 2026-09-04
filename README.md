# My AI Tutor

A free AI study-buddy app you own end to end — chat instantly as a guest, or
sign up to save your conversation history. Built with Next.js, TypeScript,
Tailwind, and Groq for fast open-model inference.

Inspired by the shape of the [klar-AI](https://github.com/abdulrdeveloper/klar-AI)
project, but simplified so you can run it locally with **one API key and no
external database** — it uses a local SQLite file instead of Postgres/Redis.

## What it does

- Guest chat, no login required
- Sign up / log in, and your conversations are saved and listed in a sidebar
- 3 model modes (Flash / Smart / Coder) via Groq
- Language toggle: English, Roman Urdu, Urdu script
- Streaming responses (tokens appear as they're generated)

## Tech stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- SQLite via `better-sqlite3` + Drizzle ORM (auto-creates tables on first run)
- JWT session cookies (`jose`) + `bcryptjs` for password hashing
- Groq's OpenAI-compatible chat completions API, streamed

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Get a free Groq API key** at https://console.groq.com

3. **Create your env file**

   ```bash
   cp .env.local.example .env.local
   ```

   Then fill in:
   ```
   GROQ_API_KEY=your_groq_api_key
   JWT_SECRET=some_long_random_string   # e.g. openssl rand -base64 32
   ```

4. **Run it**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. A `tutor.db` SQLite file is created
   automatically on first run — no database setup needed.

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
    db.ts, schema.ts         - SQLite connection + Drizzle schema
    auth.ts                  - password hashing + JWT session cookies
    models.ts                - maps friendly model names to Groq model IDs
    i18n.ts                  - UI translation strings
```

## Things you'll likely want to change as you make it "yours"

- **Models**: edit `src/lib/models.ts`. Groq renames/retires model IDs over
  time — check https://console.groq.com/docs/models for current names.
- **Branding**: `src/app/globals.css` and `tailwind.config.ts` hold the color
  palette (deep ink-blue + amber "desk lamp" accent) and fonts. Change the
  `lamp` / `bg` / `panel` colors to make it feel like your own.
- **Email verification**: this starter skips it to keep setup to one API key.
  To add it back (matching Klar's flow), you'd add a `verified` column to
  `users`, send a verification email via Resend on signup, and block login
  until it's confirmed.
- **Rate limiting**: there's none yet. For a public deployment, add a service
  like Upstash Redis to rate-limit `/api/chat` and `/api/auth/*` so one user
  can't hammer your Groq quota.
- **Production database**: SQLite is great for local dev, but for multiple
  server instances (e.g. serverless deploys) switch to Postgres — swap
  `better-sqlite3` for `pg` and `drizzle-orm/better-sqlite3` for
  `drizzle-orm/node-postgres`, and update `schema.ts`'s import from
  `sqlite-core` to `pg-core`.
- **Deploying**: Vercel is the easiest fit for Next.js. Note that SQLite
  files don't persist across serverless deploys — switch to Postgres first
  if you deploy there.

## License

MIT — do whatever you want with it.
"# Beacon-AI" 
