# Artifact

An arXiv reader that helps you understand papers and remember how they connect. Read with an AI assistant, discover related works, and build a knowledge graph that grows with every paper you explore.

Your keys, your browser, your data. Nothing is stored on a server.

![Paper review — PDF with AI assistant](docs/paper-review.png)

![Knowledge graph — related papers mapped across sessions](docs/knowledge-graph.png)

## Quick start

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000), add an API key in Settings, paste an arXiv ID or URL, and start reading.

## How it works

1. **Open a paper** — Paste any arXiv link. The PDF loads alongside a resizable panel with an AI assistant, annotation tools, and an analysis view.

2. **Read and ask** — Highlight a confusing passage and ask about it. The assistant has the full paper text as context, so answers are grounded in what you're actually reading.

3. **Analyze** — Click Analyze once per paper. The assistant identifies prerequisites, searches arXiv for related work, classifies each result by relationship type (prerequisite, builds-upon, similar approach, contrasts-with, follow-on, survey), and maps everything into a graph.

4. **Build your graph** — Every analyzed paper feeds into a single knowledge graph. Come back after ten papers and you have a map of your research area — what you've read, how it connects, and what to read next.

## Features

**Paper reviews** — Each paper gets its own session with three tabs:

- **Assistant** — Streaming AI chat with full-text context. Select text in the PDF to ask targeted questions. Markdown and LaTeX math rendering (KaTeX).
- **Notes** — Highlight passages and annotate them. Annotations anchor to specific text positions and support threaded discussion.
- **Explore** — Prerequisite checklist with study guide generation, plus a per-paper related works graph.

**Knowledge graph** — A unified, interactive graph across all your analyzed papers. Nodes are labeled with paper titles. Papers you've reviewed are visually distinct from discovered papers. Click any node to see its relationships, abstract, authors, and actions (open on arXiv, start a review). Pan, zoom, and relationship-colored edges with six types: prerequisite, builds-upon, follow-on, similar approach, contrasts-with, and survey.

**Analysis pipeline** — A multi-step pipeline that runs behind the scenes:

1. Identifies prerequisite concepts for the paper
2. Extracts search keywords from the paper's methods and contributions
3. Queries arXiv for candidate related papers
4. Classifies each candidate by relationship type with confidence scores
5. Merges results into your persistent knowledge graph

Progress appears live in the Assistant tab as each phase runs.

**Privacy** — All data lives in your browser's `localStorage`. No accounts, no telemetry, no server-side storage. API calls go directly from your browser to the model provider. Safe for pre-publication work.

**Multi-model** — Bring your own keys for Anthropic, OpenAI, or OpenRouter. Switch between Claude, GPT-4o, o3-mini, and others from a single dropdown.

## Contributing

Contributions are welcome. Please open an issue before starting work on anything substantial so we can discuss the approach.

```bash
npm run lint     # ESLint
npm run build    # Type-check + production build
```

## Tech stack

- **Framework** — Next.js 16 (App Router, Turbopack), React 19, TypeScript
- **PDF** — react-pdf / pdfjs-dist with full text extraction and selection
- **Markdown** — react-markdown, remark-gfm, remark-math, rehype-katex
- **Graph** — d3-force for layout, custom SVG rendering
- **Styling** — Tailwind CSS 4, shadcn/ui components
- **AI** — Anthropic, OpenAI, and OpenRouter APIs (streaming chat + structured generation)

<details>
<summary>Project structure</summary>

```
src/
├── app/
│   ├── api/
│   │   ├── arxiv-metadata/    # Fetch paper metadata from arXiv
│   │   ├── arxiv-search/      # Search arXiv for related papers
│   │   ├── chat/              # Streaming AI chat (multi-provider)
│   │   ├── generate/          # Structured generation for analysis pipeline
│   │   ├── models/            # Available model catalog
│   │   └── pdf/               # PDF proxy (CORS)
│   ├── discover/              # Knowledge graph page
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
└── lib/
    ├── explore-analysis       # Multi-phase analysis pipeline
    ├── explore                # Graph types, storage, merge logic
    ├── reviews                # Review sessions + chat message persistence
    ├── annotations            # Annotation CRUD
    └── models                 # Model + provider definitions
```

</details>

## License

MIT
