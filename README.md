# Artifact

Artifact is an open source workspace where researchers pair with AI to understand papers and other reading material. As you read, a background agent automatically builds and maintains your personal journal — a living record of the concepts, definitions, and connections you're picking up along the way.

Load an arXiv paper, a web article, or your own PDF into a reader beside the assistant, and ask questions grounded in the full text. Your journal grows quietly in the background as you read and chat, and every future session is grounded in what it already knows about you — no re-explaining where you left off.

**Bring your own keys (or your own machine).** Configure providers in Settings and use the models you already pay for—Anthropic, OpenAI, xAI, or any OpenAI-compatible inference API (OpenRouter, Fireworks, Together, Sail, etc.). Point it at a local endpoint (Ollama, LM Studio, llama.cpp) and run inference entirely on your machine. One selector lists every model you add.

Data stays on your machine: reviews, annotations, uploaded PDFs, and journal entries live in your browser's IndexedDB—there is no server-side database, no accounts, and no telemetry.

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

- **arXiv** — paste a paper URL or search for a paper directly in Artifact.
- **Paper or web URL** — drop in any paper link or arbitrary web page; the content is cleaned and rendered alongside the assistant.
- **Local PDF upload** — pick a PDF from your machine and it's stored locally in your browser (IndexedDB), ready to read and query.

Once a source is open, you get the content next to Assistant and Notes. Ask selection-scoped questions, and the assistant cites back into the source — answers link to specific passages and figures, and citation chips jump you to the spot in the PDF or page.

**Ambient Journal.** As you read and chat, Artifact quietly builds a personal wiki of what you're learning. The **Journal** captures key concepts, definitions, and connections across sessions, then feeds that context back into future chats so the assistant remembers what you already know — without you having to re-explain or re-link anything.

**Seed the Journal from Claude Code.** Already have months of conversations with Claude Code? Import a session export and Artifact will synthesize it into wiki entries, so your Journal starts populated instead of empty.

**Share what you've read.** Export any review or journal entry as a self-contained `.json` bundle and send it to someone else — they can drop it into their own Artifact to see the source, the chat history, and any annotations exactly as you left them. No accounts, no server, just a file.

## Contributing

Contributions are welcome. Open an issue before large changes so the approach can be discussed.

The chat agent is a [ReAct-style loop](src/app/api/chat/) over a tool registry in `src/tools/`. New or improved tools (`arxiv-search`, `search-paper`, `web-search`, `read-section`, `lookup-citation`, `rank-results`) extend what the model can do without forking the core loop.

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
- **Styling** — Tailwind CSS 4, shadcn/ui
- **Storage** — IndexedDB via Dexie (client-side, per-browser; PDFs stored as blobs)
- **AI** — Anthropic, OpenAI, xAI, OpenAI-compatible APIs (incl. local: Ollama, LM Studio, llama.cpp); streaming chat + structured generation
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
│   │   ├── generate/          # Structured generation
│   │   ├── models/            # Available model catalog
│   │   ├── papers/parse/      # Server-side paper parsing (sections, figures, citations)
│   │   ├── pdf/               # PDF proxy (CORS) + validation
│   │   ├── web-content/       # Fetch and clean arbitrary web pages
│   │   └── wiki-schema/       # Serve and edit the ambient wiki schema
│   ├── journal/               # Ambient wiki / journal view
│   ├── review/[id]/           # Reader (PDF or web page + right panel)
│   └── settings/              # API key management
├── components/
│   ├── chat-panel             # Chat with streaming + tool-step UI
│   ├── chat-step-renderers    # Per-tool UI (web search, citations, figures, etc.)
│   ├── citation-chip          # Inline citations that jump to source passages
│   ├── right-panel            # Tabbed panel (Assistant / Notes)
│   ├── pdf-viewer             # PDF renderer with text selection + annotations
│   ├── web-viewer             # Readability-cleaned web page reader
│   ├── annotation-list        # Annotation management
│   ├── share-review-dialog    # Export a review/entry as a shareable .json bundle
│   ├── import-bundle-dialog   # Import a shared review/entry bundle
│   ├── journal-import-modal   # Seed the Journal from a Claude Code session
│   └── sidebar                # Navigation + review history
├── tools/
│   ├── arxiv-search           # Paper search tool (Semantic Scholar + arXiv)
│   ├── search-paper           # Search within the open paper
│   ├── read-section           # Read a specific section of the open paper
│   ├── lookup-citation        # Resolve in-text citations to references
│   ├── web-search             # General web search tool
│   └── rank-results           # Result ranking tool
└── lib/
    ├── reviews                # Review sessions + chat message persistence
    ├── annotations            # Annotation CRUD
    ├── wiki                   # Ambient knowledge base: types, storage, ingest, journal agent
    ├── cc-import              # Claude Code session import + wiki synthesis
    ├── citation-resolver      # Map in-text citations to bibliography entries
    ├── models                 # Model + provider definitions
    ├── client/db              # Dexie (IndexedDB) schema and queries
    ├── client/pdf-blobs       # Local PDF blob storage (IndexedDB)
    └── client/sharing         # .json bundle export/import for reviews + entries
```

</details>

## License

MIT
