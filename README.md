# Artifact

Artifact is an open source workspace where researchers pair with AI to understand papers and other reading material. As you read, a background agent automatically builds and maintains your personal journal — a living record of the concepts, definitions, and connections you're picking up along the way.

Load an arXiv paper, a web article, or your own PDF into a reader beside the assistant, and ask questions grounded in the full text. Your journal grows quietly in the background as you read and chat, and every future session is grounded in what it already knows about you — no re-explaining where you left off.

**Bring your own keys.** Configure providers in Settings and use the models you already pay for—Anthropic, OpenAI, xAI, or any OpenAI-compatible inference API (OpenRouter, Fireworks, Together, Sail, etc.). One selector lists every model you add.

Data stays on your machine: reviews, annotations, uploaded PDFs, and your journal live in your browser's IndexedDB—there is no server-side database, no accounts, and no telemetry.

**Try it now:** [withartifact.com](https://withartifact.com) — no install, just add your API keys and start reading.

![Paper review — PDF with AI assistant](docs/paper-copilot.png)

## Run locally

Prefer to run it yourself (for development or self-hosting)? Clone the repo and:

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000) and add your API keys under Settings.

## Using Artifact

**Open anything.** Artifact reads from multiple sources so you can work with whatever you have in front of you:

- **arXiv ID** — paste an ID like `2401.12345` and the paper loads straight from arXiv.
- **Paper or web URL** — drop in any paper link or arbitrary web page; the content is cleaned and rendered alongside the assistant.
- **Local PDF upload** — pick a PDF from your machine and it's stored locally in your browser (IndexedDB), ready to read and query.

Once a source is open, you get the content next to Assistant, Notes, and Explore. Ask selection-scoped questions, and run **Analyze** once per source to generate a prerequisite checklist tailored to the paper.

**Ambient Journal.** As you read and chat, Artifact quietly builds a personal wiki of what you're learning. The **Journal** captures key concepts, definitions, and connections across sessions, then feeds that context back into future chats so the assistant remembers what you already know — without you having to re-explain or re-link anything.

## Contributing

Contributions are welcome. Open an issue before large changes so the approach can be discussed.

The chat agent is a [ReAct-style loop](src/app/api/chat/) over a tool registry in `src/tools/`. New or improved tools (`arxiv-search`, `web-search`, `rank-results`) extend what the model can do without forking the core loop.

```bash
npm run lint     # ESLint
npm run test     # Vitest
npm run build    # Type-check + production build
```

## Tech stack

- **Framework** — Next.js 16 (App Router, Turbopack), React 19, TypeScript
- **PDF** — react-pdf / pdfjs-dist (full text extraction and selection)
- **Web pages** — @mozilla/readability + DOMPurify for cleaned, safe rendering
- **Markdown** — react-markdown, remark-gfm, remark-math, rehype-katex
- **Editor** — Tiptap for the journal/wiki editor
- **Styling** — Tailwind CSS 4, shadcn/ui
- **Storage** — IndexedDB via Dexie (client-side, per-browser; PDFs stored as blobs)
- **AI** — Anthropic, OpenAI, xAI, OpenAI-compatible APIs (streaming chat + structured generation)
- **Paper search** — Semantic Scholar (primary), arXiv API (fallback)

<details>
<summary>Project structure</summary>

```
src/
├── app/
│   ├── api/
│   │   ├── arxiv-metadata/    # Fetch paper metadata from arXiv
│   │   ├── arxiv-search/      # Search arXiv for related papers
│   │   ├── chat/              # Streaming agentic chat (multi-provider, ReAct loop)
│   │   ├── generate/          # Structured generation for the analysis pipeline
│   │   ├── models/            # Available model catalog
│   │   ├── pdf/               # PDF proxy (CORS) + validation
│   │   ├── web-content/       # Fetch and clean arbitrary web pages
│   │   └── wiki-schema/       # Serve and edit the ambient wiki schema
│   ├── journal/               # Ambient wiki / journal view
│   ├── review/[id]/           # Reader (PDF or web page + right panel)
│   ├── settings/              # API key management
│   ├── apple-icon.tsx         # PWA apple-touch-icon (PNG, generated)
│   ├── icon.svg               # PWA favicon
│   └── manifest.ts            # PWA manifest
├── components/
│   ├── chat-panel             # Chat with streaming + analysis progress
│   ├── prerequisites-panel    # Prerequisite checklist + study guides
│   ├── right-panel            # Tabbed panel (Assistant / Notes / Explore)
│   ├── pdf-viewer             # PDF renderer with text selection + annotations
│   ├── web-viewer             # Readability-cleaned web page reader
│   ├── annotation-list        # Annotation management
│   ├── wiki-editor            # Tiptap-based journal editor
│   ├── import-bundle-dialog   # Import/preview shared review and journal bundles
│   └── sidebar                # Navigation + review history
├── hooks/
│   ├── use-auto-analysis      # Analysis trigger + status tracking
│   ├── use-chat               # Streaming chat client + tool-call plumbing
│   └── use-explore-data       # Reactive access to prerequisite data
├── tools/
│   ├── arxiv-search           # Paper search tool (Semantic Scholar + arXiv)
│   ├── web-search             # General web search tool
│   └── rank-results           # Result ranking tool
└── lib/
    ├── explore-analysis       # Prerequisite generation pipeline
    ├── explore                # Prerequisite + search-result types
    ├── reviews                # Review sessions + chat message persistence
    ├── annotations            # Annotation CRUD
    ├── deep-dives             # Advanced learning sessions
    ├── wiki                   # Ambient knowledge base: types, storage, ingest, journal agent
    ├── models                 # Model + provider definitions
    ├── client/sharing         # Review and journal bundle export/import
    └── client/db              # Dexie (IndexedDB) schema and queries
```

</details>

## License

MIT
