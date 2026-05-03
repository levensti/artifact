# Artifact

Artifact is an open source workspace designed to help researchers stay at the frontier. With Artifact, you can easily pair with AI to deeply understand research papers, technical blogs, or other reading materials, and automatically keep track of what you've learned and where to dig deeper.

**Study anything.** Artifact supports Arxiv papers, arbitrary web URLs (e.g. technical blogs), and local file uploads so you can truly study anything that helps uplevel you as a researcher.

Once a source is open, you get the content next to Assistant and Notes. Ask selection-scoped questions, and the assistant cites back into the source — answers link to specific passages and figures, and citation chips jump you to the spot in the PDF or page.

**Automatically maintain a personal journal of learnings.** Capture what you're learning across sessions — key concepts, definitions, and the connections between them. Snapshot a chat into an entry with one click, or open the composer and draft an entry from your recent reading and notes. Every entry feeds context back into future chats, so the assistant remembers what you already know without you re-explaining. Already have conversations with Claude Code? Import a session export and Artifact will synthesize it into wiki entries to help summarize what you've learned so far.

**Share what you've learned.** Want to share your learnings with a friend or colleage? Easily generate a shareable bundle for your study session (notes, questions, answers, etc).

**Bring your own keys (or run inference locally).** To keep Artifact free, we operate with a bring-your-own-capacity model. We support Anthropic, OpenAI, xAI, or any OpenAI-compatible inference API (OpenRouter, Fireworks, Together, Sail, etc.), including local inference (Ollama, LM Studio, llama.cpp) that runs on your own machine. One selector lists every compatible model.

**Try our hosted solution for free (no paid tier):** [withartifact.com](https://withartifact.com) — sign in with Google and add your API keys to start reading.

![Paper review — PDF with AI assistant](docs/paper-copilot.png)

**Self hosting:** Easily self-host or run locally using the instructions below.

## Run locally

Self-hosting requires a Postgres database, an object storage bucket, and a Google OAuth client. The fastest path uses Supabase (Postgres + Storage in one project) and a free Google Cloud OAuth app.

### 1. Provision external services

- **Supabase project** ([supabase.com](https://supabase.com)) — gives you Postgres + Storage. Note the project URL, the `service_role` key (Settings → API), and create a private Storage bucket named `learning-material`.
- **Google OAuth client** ([Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → OAuth client ID, type "Web application") — add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI. Copy the client ID and secret.

### 2. Configure environment

Create a `.env` file at root and fill in:

```env
# Postgres connection strings from Supabase → Connect
DATABASE_URL="..."   # pooled (port 6543, ?pgbouncer=true)
DIRECT_URL="..."     # direct (port 5432)

# Auth.js
AUTH_SECRET=""       # openssl rand -base64 32
AUTH_URL="http://localhost:3000"
AUTH_GOOGLE_ID=""
AUTH_GOOGLE_SECRET=""

# Supabase Storage
SUPABASE_URL="https://<project-ref>.supabase.co"
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_BUCKET="learning-material"
```

### 3. Install + migrate + run

```bash
npm install
npm run db:migrate    # creates the schema in Postgres
npm run dev
```

Open [localhost:3000](http://localhost:3000), sign in with Google, then add your AI provider keys under Settings.

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
