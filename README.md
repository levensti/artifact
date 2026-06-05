# Artifact

Artifact is an open source (MIT licensed) reading workspace for researchers. Read any paper / blog / PDF with the help of a powerful, personalized AI assistant; build a journal of your learnings; and easily discovery what to read next.

Hosted version available at [withartifact.com](https://withartifact.com). Powered by OpenRouter — bring your own OpenRouter key, or use the platform key. Completely free to use.

## Features

### Read with an AI assistant that knows the paper

Open any arXiv paper, blog, or PDF. The assistant has the full text in context, so you can ask questions, request derivations, pull side-by-side definitions, or highlight a passage to dive deeper. Margin notes and AI threads live in a notes rail next to the page.

![Paper review: PDF with AI assistant and notes rail](docs/screenshots/paper-review.png)

### A journal that compounds across sessions

Every reading session becomes a linked entry. Concepts, methods, and papers cross-reference each other automatically, so what you learned last week shows up when it's relevant this week.

![Journal: cross-linked entries from past sessions](docs/screenshots/journal.png)

### Discover what to read next

A personalized feed of papers based on what you've been reading and what you've journaled. One click to start a review.

![Discover feed of recommended papers](docs/screenshots/discovery.png)

### Share a review with a colleague

Generate a live link to any review. Recipients import a copy with chats, annotations, and deep dives intact, into their own workspace.

<p align="center">
  <img src="docs/screenshots/share-review-init.png" alt="Share dialog with copy link" width="49%" />
  <img src="docs/screenshots/share-review-accept.png" alt="Recipient landing page for a shared review" width="49%" />
</p>

## Contributing

Contributions are welcome. Open an issue before making changes so the approach can be discussed.

### Local development

Spins up Postgres + Storage + Studio in Docker via the Supabase CLI. No hosted project required. Requires [Docker](https://www.docker.com/) running.

```bash
npx supabase start       # boots the stack; prints credentials when ready
```

`start` prints a block like:

```
API URL: http://127.0.0.1:54321
DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL: http://127.0.0.1:54323
service_role key: eyJhbGciOi...
```

(Optional: run `npx supabase init` first if you want to commit a `supabase/config.toml` to share custom ports/Postgres version, or to `supabase link` against a hosted project. Solo dev with defaults doesn't need it.)

You'll also need a **Google OAuth client** (one-time): [Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID, type "Web application". Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.

Copy [`.env.example`](./.env.example) to `.env` and map the printed credentials:

| `.env` variable                         | Value                                      |
| --------------------------------------- | ------------------------------------------ |
| `DATABASE_URL`                          | `DB URL` from `supabase start`             |
| `DIRECT_URL`                            | same as `DATABASE_URL` (no pooler locally) |
| `SUPABASE_URL`                          | `API URL` from `supabase start`            |
| `SUPABASE_SERVICE_ROLE_KEY`             | `service_role key` from `supabase start`   |
| `SUPABASE_BUCKET`                       | `learning-material`                        |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | from your Google OAuth client              |
| `AUTH_SECRET` / `ENCRYPTION_KEY`        | generate per `.env.example`                |

Open Studio (the printed URL, default `http://127.0.0.1:54323`) → Storage → create a private bucket named `learning-material`.

The multi-host routing variables (`APEX_HOSTS`, `APP_HOST`, `AUTH_URL`, `AUTH_COOKIE_DOMAIN`) are production-only; leave them unset locally.

Then:

```bash
npm install
npm run db:migrate    # applies prisma/migrations/* to the local Postgres
npm run dev
```

Open [localhost:3000](http://localhost:3000) and sign in with Google. Set `OPENROUTER_API_KEY` in `.env` so users can start chatting immediately, or have each user add their own OpenRouter key under Settings.

#### Platform key vs. bring-your-own-key

The app runs a single model (`deepseek/deepseek-v4-flash`) via OpenRouter — there is no model picker. If you set `OPENROUTER_API_KEY`, signed-in users with no key of their own automatically use it — no setup step required. A user who enters their own OpenRouter key under Settings uses that instead. The platform key is server-only and never sent to the browser. The fallback is opt-in: leave the var unset to require users to bring a key. (See the cost note in `.env.example`.)

### Day-to-day commands

```bash
npm run lint                   # ESLint
npm run test                   # Vitest
npm run typecheck              # tsc --noEmit
npm run build                  # production build
npm run db:migrate             # apply new prisma migrations
npm run db:studio              # Prisma Studio (browse/edit DB rows)

npx supabase stop              # tear the stack down (data persists in Docker volumes)
npx supabase start             # bring it back up
npx supabase db reset          # nuke the DB and re-run all prisma migrations from scratch
npx supabase status            # print URLs and keys again
```

### Tech stack

- **Framework**: Next.js (App Router, Turbopack), React, TypeScript
- **Auth**: Auth.js with Google OAuth
- **Database**: Postgres (Supabase), Prisma ORM
- **Object storage**: Supabase Storage (PDFs and other uploads, scoped per user)
- **PDF**: react-pdf / pdfjs-dist (full text extraction and selection)
- **Web pages**: @mozilla/readability + DOMPurify for cleaned, safe rendering
- **Markdown**: react-markdown, remark-gfm, remark-math, rehype-katex
- **Styling**: Tailwind CSS, shadcn/ui
- **AI**: OpenRouter (single fixed model: `deepseek/deepseek-v4-flash`); streaming chat + structured generation
- **Paper search**: Semantic Scholar (primary), arXiv API (fallback)

## Deployment (self-hosting)

Artifact can be self-hosted on any platform that runs a Next.js app. You'll need a Postgres database, an object storage bucket, and a Google OAuth client.

### 1. Provision external services

- **Supabase project** ([supabase.com](https://supabase.com)) gives you Postgres + Storage in one project. Note the project URL, the `service_role` key (Settings → API), and create a private Storage bucket named `learning-material`.
- **Google OAuth client** ([Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID, type "Web application"): add your deployment's `https://<your-domain>/api/auth/callback/google` as an authorized redirect URI. Copy the client ID and secret.

### 2. Configure environment

Copy [`.env.example`](./.env.example) to `.env` and fill in the required values. Every variable is documented inline: what it does, where to get the value, and which are local vs. production-only.

For a deployed instance you'll need: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `ENCRYPTION_KEY`, plus the multi-host routing variables (`APEX_HOSTS`, `APP_HOST`, `AUTH_URL`, `AUTH_COOKIE_DOMAIN`). Optionally set `OPENROUTER_API_KEY` to give keyless users a working model out of the box (see the platform-key note above).

### 3. Build and run

```bash
npm install
npm run build:deploy   # runs prisma migrate deploy + next build
npm start
```

Sign in with Google, then add your OpenRouter key under Settings (or rely on the platform `OPENROUTER_API_KEY`).
