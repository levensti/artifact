# Artifact

Artifact is an open source **digital workspace that helps researchers discover the frontier**. The paper stays in view, the model has the full text, and your session keeps notes, analysis, and links between papers — so you stop losing context every time you switch tabs.

Ask questions with proper grounding, see suggested prerequisite topics and related work, and build a map of how papers connect as you read more than one.

**Bring your own keys.** Configure providers in Settings and use the models you already pay for—Anthropic, OpenAI, xAI, or any OpenAI-compatible inference API (OpenRouter, Fireworks, Together, Sail, etc.). One selector lists every model you add.

Data stays on your machine: reviews, annotations, uploaded PDFs, and graph state live in your browser's IndexedDB—there is no server-side database, no accounts, and no telemetry.

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

Once a source is open, you get the content next to Assistant, Notes, and Explore. Ask selection-scoped questions, and run **Analyze** once per source to fill prerequisites, related candidates, and the shared graph. Use **Discovery** to browse how analyzed papers relate and what to open next.

**Ambient Journal.** As you read and chat, Artifact quietly builds a personal wiki of what you're learning. The **Journal** captures key concepts, definitions, and connections across sessions, then feeds that context back into future chats so the assistant remembers what you already know — without you having to re-explain or re-link anything.

![Knowledge graph — related papers mapped across sessions](docs/knowledge-graph.png)

## Contributing

Contributions are welcome. Open an issue before large changes so the approach can be discussed.

The chat agent is a [ReAct-style loop](src/app/api/chat/) over a tool registry in `src/tools/`. New or improved tools (`arxiv-search`, `web-search`, `rank-results`, `save-to-graph`) extend what the model can do without forking the core loop.

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
- **Graph** — React Flow (@xyflow/react) with custom paper nodes and relationship edges
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
│   │   ├── generate/          # Structured generation for analysis pipeline
│   │   ├── models/            # Available model catalog
│   │   ├── pdf/               # PDF proxy (CORS) + validation
│   │   ├── web-content/       # Fetch and clean arbitrary web pages
│   │   └── wiki-schema/       # Serve and edit the ambient wiki schema
│   ├── discovery/             # Knowledge graph page
│   ├── journal/               # Ambient wiki / journal view
│   ├── review/[id]/           # Reader (PDF or web page + right panel)
│   └── settings/              # API key management
├── components/
│   ├── related-works-graph    # Interactive graph (React Flow, custom nodes + edges)
│   ├── graph-canvas           # React Flow canvas with paper nodes and relationship edges
│   ├── chat-panel             # Chat with streaming + analysis progress
│   ├── prerequisites-panel    # Prerequisite checklist + study guides
│   ├── right-panel            # Tabbed panel (Assistant / Notes / Explore)
│   ├── pdf-viewer             # PDF renderer with text selection + annotations
│   ├── web-viewer             # Readability-cleaned web page reader
│   ├── annotation-list        # Annotation management
│   └── sidebar                # Navigation + review history
├── hooks/
│   ├── use-auto-analysis      # Analysis trigger + status tracking
│   └── use-explore-data       # Reactive access to graph/prerequisite data
├── tools/
│   ├── arxiv-search           # Paper search tool (Semantic Scholar + arXiv)
│   ├── web-search             # General web search tool
│   ├── rank-results           # Result ranking tool
│   └── save-to-graph          # Knowledge graph persistence tool
└── lib/
    ├── explore-analysis       # Multi-phase analysis pipeline
    ├── explore                # Graph types, storage, merge logic
    ├── reviews                # Review sessions + chat message persistence
    ├── annotations            # Annotation CRUD
    ├── deep-dives             # Advanced learning sessions
    ├── wiki                   # Ambient knowledge base: types, storage, ingest, journal agent
    ├── models                 # Model + provider definitions
    ├── client/db              # Dexie (IndexedDB) schema and queries
    └── client/pdf-blobs       # Local PDF blob storage (IndexedDB)
```

</details>

## License

MIT
