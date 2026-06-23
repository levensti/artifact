# Artifact

Artifact is an open source (MIT licensed) workspace for researchers to discover and dive deep on papers with the help of a powerful, personalized AI assistant, supporting papers on ArXiv, uploaded documents, and arbitrary website links (e.g. technical blog).

We offer a free-to-use hosted version at [withartifact.com](https://withartifact.com) and include instructions for self-hosting below.

## Features

### Discover what to read

Have a domain in mind and want to get a lay of the land? Tell Artifact what you'd like to go deep on and it performs web search, reads the papers it finds, and synthesizes a list of papers (in order of importance) for you to explore.

![Discover feed of recommended papers](docs/demo_screenshots/discovery.png)

### Read with an AI assistant that knows the paper

The assistant has the full text in context, so you can ask questions, request derivations, pull side-by-side definitions, or highlight a passage to dive deeper. Margin notes and AI threads live in a notes rail next to the page.

![Paper review: PDF with AI assistant and notes rail](docs/demo_screenshots/paper-review.png)

### Share a review with a colleague

Generate a link that your colleagues can use to import your paper review, including your chats, notes, and deep dives.

<img src="docs/demo_screenshots/share-review-init.png" alt="Share dialog with copy link" width="49%" />

## Support

We are grateful for the support of the following organizations that make it possible for us to offer a hosted version of Artifact with generous inference usage for free for our users.

<table>
  <tr>
    <td align="center" valign="middle" width="240" height="80">
      <a href="https://vercel.com/open-source-program">
        <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge-2026.svg" height="42" />
      </a>
    </td>
    <td align="center" valign="middle" width="240" height="80">
      <a href="https://www.anthropic.com">
        <img alt="Claude" src="docs/supporters/claude_code_logo.svg" height="26" />
      </a>
    </td>
    <td align="center" valign="middle" width="240" height="80">
      <a href="https://fireworks.ai">
        <img alt="Fireworks AI" src="docs/supporters/fireworks_logo.png" height="34" />
      </a>
    </td>
  </tr>
  <tr>
    <td align="center"><sub><b>Vercel</b><br/>Open source program — hosting</sub></td>
    <td align="center"><sub><b>Claude</b><br/>Open source program — model credits</sub></td>
    <td align="center"><sub><b>Fireworks AI</b><br/>Inference credits</sub></td>
  </tr>
</table>

## Contributing

Open source contributions are welcome. Open an issue before making changes so the approach can be discussed.

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

### Relevant commands

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
