# Artifact

Artifact is an open source workspace designed to help researchers stay at the frontier. With Artifact, you can easily pair with AI to deeply understand research papers, technical blogs, or other reading materials, and automatically keep track of what you've learned and where to dig deeper.

**Study anything.** Artifact supports Arxiv papers, arbitrary web URLs (e.g. technical blogs), and local file uploads so you can truly study anything that helps uplevel you as a researcher.

Once a source is open, you get the content next to Assistant and Notes. Ask selection-scoped questions, and the assistant cites back into the source — answers link to specific passages and figures, and citation chips jump you to the spot in the PDF or page.

**Automatically maintain a personal journal of learnings.** Capture what you're learning across sessions — key concepts, definitions, and the connections between them. Snapshot a chat into an entry with one click, or open the composer and draft an entry from your recent reading and notes. Every entry feeds context back into future chats, so the assistant remembers what you already know without you re-explaining. Already have conversations with Claude Code? Import a session export and Artifact will synthesize it into wiki entries to help summarize what you've learned so far.

**Share what you've learned.** Want to share your learnings with a friend or colleage? Easily generate a shareable bundle for your study session (notes, questions, answers, etc).

**Bring your own keys (or run inference locally).** To keep Artifact free, we operate with a bring-your-own-capacity model. We support Anthropic, OpenAI, xAI, or any OpenAI-compatible inference API (OpenRouter, Fireworks, Together, Sail, etc.), including local inference (Ollama, LM Studio, llama.cpp) that runs on your own machine. One selector lists every compatible model.

**Try our hosted solution for free (no paid tier):** [withartifact.com](https://withartifact.com) — sign in with Google and add your API keys to start reading.

![Paper review — PDF with AI assistant](docs/paper-review.png)

**Self hosting:** Easily self-host or run locally using the instructions below.

## Run locally

Self-hosting requires a Postgres database, an object storage bucket, and a Google OAuth client. Two paths:

- **[Local Supabase (fastest for dev)](#option-a-local-supabase-via-cli-recommended-for-dev)** — Postgres + Storage in Docker on your machine, one command to boot.
- **[Hosted Supabase project](#option-b-hosted-supabase-project)** — production-like setup with a real cloud project.

Both paths share the same Google OAuth setup and end with `npm run db:migrate && npm run dev`.

### Common: Google OAuth client

[Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID, type "Web application". Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. Copy the client ID and secret — they go in `.env` as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

### Option A: Local Supabase via CLI (recommended for dev)

Spins up Postgres + Storage + Studio in Docker. Requires [Docker](https://www.docker.com/) running.

```bash
npx supabase start       # boots the stack with default ports; prints credentials when ready
```

That's it for the stack. (Optional: `npx supabase init` first if you want to commit a `supabase/config.toml` to share custom ports/Postgres version with collaborators, or to `supabase link` against a hosted project. Solo dev with defaults doesn't need it.)

When `start` finishes it prints a block like:

```
API URL: http://127.0.0.1:54321
DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL: http://127.0.0.1:54323
service_role key: eyJhbGciOi...
```

Map those into your `.env` (copy from [`.env.example`](./.env.example)):

| `.env` variable | Value |
| --- | --- |
| `DATABASE_URL` | `DB URL` from above |
| `DIRECT_URL` | same as `DATABASE_URL` (no pooler locally) |
| `SUPABASE_URL` | `API URL` from above |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role key` from above |
| `SUPABASE_BUCKET` | `learning-material` |

Open Studio (the printed URL, default `http://127.0.0.1:54323`) → Storage → create a private bucket named `learning-material`.

Then fill in the remaining vars (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ENCRYPTION_KEY` — see `.env.example` for how to generate the secrets) and:

```bash
npm install
npm run db:migrate    # applies prisma/migrations/* to the local Postgres
npm run dev
```

Open [localhost:3000](http://localhost:3000), sign in with Google, add your AI provider keys under Settings.

**Day-to-day commands:**

```bash
npx supabase stop              # shut the stack down (data persists in Docker volumes)
npx supabase start             # bring it back up
npx supabase db reset          # nuke the DB and re-run all prisma migrations from scratch
npx supabase status            # print URLs and keys again
```

### Option B: Hosted Supabase project

Use this when you want a production-like environment or are deploying.

1. Create a project at [supabase.com](https://supabase.com). Note the project URL, the `service_role` key (Settings → API), and create a private Storage bucket named `learning-material`.
2. Copy [`.env.example`](./.env.example) to `.env` and fill in the required values. The example file documents every variable inline. For local dev against a hosted project you'll need: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET`, `ENCRYPTION_KEY`. The multi-host routing variables (`APEX_HOSTS`, `APP_HOST`, `AUTH_URL`, `AUTH_COOKIE_DOMAIN`) are production-only — leave them unset locally.
3. Install, migrate, run:

   ```bash
   npm install
   npm run db:migrate
   npm run dev
   ```

## Contributing

Contributions are welcome. Open an issue before large changes so the approach can be discussed.

## Tech stack

- **Framework** — Next.js (App Router, Turbopack), React, TypeScript
- **Auth** — Auth.js with Google OAuth
- **Database** — Postgres (Supabase), Prisma ORM
- **Object storage** — Supabase Storage (PDFs and other uploads, scoped per user)
- **PDF** — react-pdf / pdfjs-dist (full text extraction and selection)
- **Web pages** — @mozilla/readability + DOMPurify for cleaned, safe rendering
- **Markdown** — react-markdown, remark-gfm, remark-math, rehype-katex
- **Styling** — Tailwind CSS, shadcn/ui
- **AI** — Anthropic, OpenAI, xAI, OpenAI-compatible APIs (incl. local: Ollama, LM Studio, llama.cpp); streaming chat + structured generation
- **Paper search** — Semantic Scholar (primary), arXiv API (fallback)

## Relevant commands for development

```bash
npm run lint        # ESLint
npm run test        # Vitest
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm run db:studio   # Prisma Studio (browse/edit DB rows)
```

## License

MIT
