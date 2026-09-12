# Beacon

A free AI study-buddy app you own end to end — chat instantly as a guest, or
sign up to save your conversation history. Built with Next.js, TypeScript,
Tailwind, and multi-provider AI inference (Groq + Mistral) for fast open-model
answers that survive rate limits.

## What it does

- Guest chat, no login required (Flash model)
- Sign up / log in to unlock all models and save conversations in a sidebar
- 3 model modes: **Flash** (quick), **Smart** (reasoning), **Coder** (code)
- Multi-provider rotation: requests alternate across Groq and Mistral; a
  rate-limited or unavailable provider is benched and traffic fails over
- Language toggle: English, Roman Urdu, Urdu script
- Streaming responses (tokens appear as they're generated)
- Email verification via Resend (optional — enable by setting `RESEND_API_KEY`)
- Abuse protection: per-user/IP rate limits on chat and auth endpoints,
  backed by Upstash Redis in production (shared across instances)

## Tech stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Postgres (Neon) + Drizzle ORM
- JWT session cookies (`jose`) + `bcryptjs` for password hashing
- Groq + Mistral OpenAI-compatible chat completions APIs, streamed

## Getting started (local development)

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Get free API keys**
   - Groq: https://console.groq.com
   - Mistral (optional but recommended): https://console.mistral.ai

3. **Get a free Postgres database** at https://neon.tech — copy the
   connection string (starts with `postgresql://`).

4. **Create your env file**

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in `GROQ_API_KEY`, `MISTRAL_API_KEY`, `JWT_SECRET` (32+ random chars),
   and `DATABASE_URL`.

5. **Create the database tables** — open the SQL editor in your Neon
   dashboard and run the contents of `drizzle/0000_init.sql` (once).
   Alternatively run `npm run db:push` locally.

6. **Run it**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## Deploying to Vercel

1. Push this project to a GitHub repo.
2. Go to https://vercel.com/new and import the repo.
3. Add the environment variables from `.env.local.example` in the project's
   Environment Variables settings (`DATABASE_URL`, `JWT_SECRET`,
   `GROQ_API_KEY`, `MISTRAL_API_KEY`, and for production also
   `RESEND_API_KEY` + `EMAIL_FROM` + `NEXT_PUBLIC_APP_URL` and the two
   `UPSTASH_REDIS_REST_*` variables).
4. Run `drizzle/0000_init.sql` against your production database (once) if you
   haven't already.
5. Deploy. Vercel auto-detects Next.js — no build configuration needed.

## Project structure

```
src/
  app/
    page.tsx                 - landing page with live demo
    chat/                    - fullscreen guest chat
    login/, signup/          - auth screens
    dashboard/page.tsx       - logged-in chat with saved conversation sidebar
    api/
      chat/route.ts          - streams responses, saves history if logged in
      auth/*                 - signup, login, logout, current-user routes
      conversations/*        - list + fetch saved conversations
  components/                - ChatWindow, Sidebar, ModelSelector, LanguageToggle, MessageBubble
  lib/
    db.ts, schema.ts         - Postgres (Neon) connection + Drizzle schema
    auth.ts                  - password hashing + JWT session cookies
    providers.ts             - multi-provider (Groq/Mistral) rotation + failover
    rateLimit.ts             - in-memory sliding-window rate limiter
    models.ts                - friendly model modes (Flash/Smart/Coder)
    i18n.ts                  - UI translation strings
drizzle/
  0000_init.sql              - run once against your database to create tables
```

## Production notes

- **JWT_SECRET must be 32+ random characters** in production — the app
  refuses to issue sessions without it (`openssl rand -base64 48`).
- **Rate limits use Upstash Redis** when `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN` are set (shared across all instances), with an
  automatic in-memory fallback if Redis errors.
- **Email verification is active** when `RESEND_API_KEY` is set: signups get
  a 24-hour verification link (tokens are single-use and stored hashed in
  Redis, or in-memory without Redis), and unverified accounts can't log in
  but can resend the link from the login page. Leave it unset in dev to
  skip verification entirely.
- **Model IDs change over time** — check providers in `src/lib/providers.ts`
  against https://console.groq.com/docs/models and Mistral's model list if a
  provider starts erroring with tier/not-found errors (the pool will fail
  over automatically in the meantime).

## License

MIT — do whatever you want with it.
