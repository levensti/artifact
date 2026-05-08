# Artifact

Artifact is an open source (MIT licensed) reading workspace for researchers. Read any paper / blog / PDF with the help of a powerful, personalized AI assistant; build a journal of your learnings; and easily discovery what to read next.

Hosted version available at [withartifact.com](https://withartifact.com). Bring your own keys (Anthropic, OpenAI, xAI, OpenAI-compatible, or local via Ollama / LM Studio / llama.cpp). Completely free to use.

![Paper review: PDF with AI assistant](docs/paper-review.png)

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

Open [localhost:3000](http://localhost:3000), sign in with Google, then add your AI provider keys under Settings.

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
- **AI**: Anthropic, OpenAI, xAI, OpenAI-compatible APIs (incl. local: Ollama, LM Studio, llama.cpp); streaming chat + structured generation
- **Paper search**: Semantic Scholar (primary), arXiv API (fallback)

## License

MIT

## Deployment (self-hosting)

Artifact can be self-hosted on any platform that runs a Next.js app. You'll need a Postgres database, an object storage bucket, and a Google OAuth client.

### 1. Provision external services

- **Supabase project** ([supabase.com](https://supabase.com)) gives you Postgres + Storage in one project. Note the project URL, the `service_role` key (Settings → API), and create a private Storage bucket named `learning-material`.
- **Google OAuth client** ([Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID, type "Web application"): add your deployment's `https://<your-domain>/api/auth/callback/google` as an authorized redirect URI. Copy the client ID and secret.

### 2. Configure environment

Copy [`.env.example`](./.env.example) to `.env` and fill in the required values. Every variable is documented inline: what it does, where to get the value, and which are local vs. production-only.

For a deployed instance you'll need: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `ENCRYPTION_KEY`, plus the multi-host routing variables (`APEX_HOSTS`, `APP_HOST`, `AUTH_URL`, `AUTH_COOKIE_DOMAIN`).

### 3. Build and run

```bash
npm install
npm run build:deploy   # runs prisma migrate deploy + next build
npm start
```

Sign in with Google, then add your AI provider keys under Settings.
