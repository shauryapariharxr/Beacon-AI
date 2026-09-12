# Beacon

A free, self-hostable AI study companion. Chat instantly as a guest — no
account required — or sign up to save your conversation history. Built with
Next.js, TypeScript, Tailwind CSS, and multi-provider AI inference (Groq +
Mistral) for fast, open-model answers that survive rate limits.

## Features

- **Guest chat** — start chatting immediately, no login needed (Flash model)
- **Accounts & history** — sign up to unlock all models and keep a searchable conversation sidebar
- **Three model modes** — Flash (quick), Smart (reasoning), Coder (code)
- **Multi-provider failover** — requests rotate across Groq and Mistral; a rate-limited or unavailable provider is temporarily benched while traffic fails over
- **Streaming responses** — tokens render as they are generated
- **Language toggle** — English, Roman Urdu, Urdu script
- **Contact form** — messages delivered to the owner's inbox via Resend
- **Abuse protection** — per-user/IP rate limits on chat and auth endpoints, backed by Upstash Redis in production with an in-memory fallback

## Tech stack

| Layer      | Technology                                        |
| ---------- | ------------------------------------------------- |
| Framework  | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Database   | PostgreSQL (Neon) via Drizzle ORM                 |
| Auth       | JWT session cookies (`jose`), `bcryptjs` hashing  |
| AI         | Groq + Mistral OpenAI-compatible APIs, streamed   |
| Rate limit | Upstash Redis (optional), in-memory fallback      |

## Getting started

### Prerequisites

- Node.js 18+
- A free [Groq](https://console.groq.com) API key (Mistral optional)
- A free [Neon](https://neon.tech) Postgres database

### Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in `GROQ_API_KEY`, `DATABASE_URL`, and `JWT_SECRET` (32+ random
   characters). `MISTRAL_API_KEY` is optional but recommended.

3. **Create the database tables**

   Run the contents of `drizzle/0000_init.sql` once in your Neon SQL editor,
   or generate the schema locally:

   ```bash
   npm run db:push
   ```

4. **Start the dev server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Deployment

### Vercel (recommended)

1. Push the repository to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new) — Next.js is auto-detected.
3. Add the environment variables from `.env.local.example`:
   - Required: `DATABASE_URL`, `JWT_SECRET`, `GROQ_API_KEY`
   - Optional: `MISTRAL_API_KEY`, `NEXT_PUBLIC_APP_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
   - Contact form only: `RESEND_API_KEY`, `CONTACT_EMAIL`, `EMAIL_FROM`
4. Run `drizzle/0000_init.sql` against the production database (once).

### Other platforms

Any Node.js host works. Build with `npm run build`, start with `npm start`,
and provide the same environment variables. A serverless-friendly Postgres
provider (e.g. Neon) is recommended for edge/idle behavior.

## Project structure

```
src/
  app/
    page.tsx                 Landing page with live demo
    chat/                    Fullscreen guest chat
    dashboard/               Logged-in chat with saved conversations
    login/, signup/          Auth screens
    contact/                 Contact form page
    api/
      chat/route.ts          Streams responses; persists history when logged in
      auth/                  signup, login, logout, me
      conversations/         List and fetch saved conversations
      contact/route.ts       Contact form delivery via Resend
  components/                ChatWindow, Sidebar, ModelSelector, LanguageToggle, MessageBubble
  lib/
    db.ts, schema.ts         Postgres connection + Drizzle schema
    auth.ts                  Password hashing + JWT session cookies
    providers.ts             Multi-provider rotation and failover
    rateLimit.ts             Sliding-window rate limiter (Redis or in-memory)
    models.ts                Model modes (Flash / Smart / Coder)
    i18n.ts                  UI translation strings
drizzle/
  0000_init.sql              Run once to create all tables
```

## Available scripts

| Command            | Description                        |
| ------------------ | ---------------------------------- |
| `npm run dev`      | Start the development server       |
| `npm run build`    | Create a production build          |
| `npm start`        | Run the production build           |
| `npm run lint`     | Run ESLint                         |
| `npm run db:push`  | Push the Drizzle schema to Postgres |
| `npm run db:studio`| Open Drizzle Studio                |

## Environment variables

| Variable                  | Required | Description                                                    |
| ------------------------- | -------- | -------------------------------------------------------------- |
| `DATABASE_URL`            | Yes      | Postgres connection string (Neon pooled)                       |
| `JWT_SECRET`              | Yes      | 32+ random chars (`openssl rand -base64 48`)                   |
| `GROQ_API_KEY`            | Yes*     | Groq API key. *One AI provider is required*                    |
| `MISTRAL_API_KEY`         | No       | Adds failover capacity across providers                        |
| `UPSTASH_REDIS_REST_URL`  | No       | Shared rate limiting across instances                          |
| `UPSTASH_REDIS_REST_TOKEN`| No       | Upstash REST token                                             |
| `RESEND_API_KEY`          | No       | Enables the contact form                                       |
| `CONTACT_EMAIL`           | No       | Recipient for contact messages                                 |
| `EMAIL_FROM`              | No       | From address for contact emails                                |
| `NEXT_PUBLIC_APP_URL`     | No       | Public URL, used for canonical links                           |

## Production notes

- **Session security** — `JWT_SECRET` must be 32+ random characters in
  production; the app refuses to issue sessions without it.
- **Rate limiting** — with Upstash configured, limits are shared across all
  serverless instances. On Redis errors the limiter degrades gracefully to
  in-memory windows per instance.
- **Email verification** — intentionally omitted: signup creates the account
  and signs the user in immediately. There is no password-reset flow.
- **Model availability** — model IDs change over time. If a provider starts
  returning tier or not-found errors, check the pools in `src/lib/providers.ts`
  against the [Groq model list](https://console.groq.com/docs/models) and
  Mistral's model list. The failover pool keeps serving traffic meanwhile.

## License

[MIT](LICENSE)
