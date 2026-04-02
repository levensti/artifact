# Artifact

Artifact is an open source workspace for deeply understanding research papers with AI: the paper stays in view, the model has the full text, and your session keeps notes, analysis, and links between papers instead of losing context every time you switch tabs.

Ask questions with proper grounding, see suggested prerequisite topics and related work, and build a map of how papers connect as you read more than one.

**Bring your own keys.** Configure providers in Settings and use the models you already pay for—Anthropic, OpenAI, xAI, or any OpenAI-compatible inference API (OpenRouter, Fireworks, Together, Sail, etc.). One selector lists every model you add.

Data stays on your machine: reviews and graph state live in SQLite on the server (`/data/artifact.db`). There are no accounts and no telemetry.

![Paper review — PDF with AI assistant](docs/paper-copilot.png)

## Quick start

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000), add API keys under Settings, then open a paper (by arXiv ID or URL—the PDF loads in the reader).

## Using Artifact

Open a paper to get the PDF next to Assistant, Notes, and Explore. Read and ask with selection-scoped questions; run **Analyze** once per paper to fill prerequisites, related candidates, and the shared graph. Use **Discovery** to browse how analyzed papers relate and what to open next.

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
- **Markdown** — react-markdown, remark-gfm, remark-math, rehype-katex
- **Graph** — d3-force layout, SVG rendering
- **Styling** — Tailwind CSS 4, shadcn/ui
- **Storage** — SQLite (better-sqlite3), WAL mode
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
│   │   ├── data/              # CRUD persistence (reviews, annotations, settings, graph)
│   │   ├── generate/          # Structured generation for analysis pipeline
│   │   ├── models/            # Available model catalog
│   │   └── pdf/               # PDF proxy (CORS)
│   ├── discovery/             # Knowledge graph page
│   ├── review/[id]/           # Paper reader (PDF + right panel)
│   └── settings/              # API key management
├── components/
│   ├── related-works-graph    # Interactive graph (d3-force, SVG, pill nodes)
│   ├── chat-panel             # Chat with streaming + analysis progress
│   ├── prerequisites-panel    # Prerequisite checklist + study guides
│   ├── right-panel            # Tabbed panel (Assistant / Notes / Explore)
│   ├── pdf-viewer             # PDF renderer with text selection + annotations
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
    ├── models                 # Model + provider definitions
    └── server/store           # SQLite database operations
```

</details>

## License

MIT
