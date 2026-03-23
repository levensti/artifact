# Paper Copilot

AI-powered research paper reading companion. Open Arxiv papers, pair with an AI copilot to understand them — select text, ask questions, get instant explanations.

## Features

- **Dashboard with Studies** — Create study sessions per paper, organized in a sidebar with date grouping (like ChatGPT). Multiple studies per paper supported.
- **PDF Viewer** — Renders Arxiv papers with full text selection, zoom, and page navigation
- **AI Chat** — Ask questions about the paper with full-text context. Streaming responses with markdown and LaTeX math rendering (KaTeX)
- **Text Selection → Ask** — Select any passage in the PDF, click "Ask about this" for a targeted explanation
- **Multi-Model** — Switch between Claude Sonnet/Opus 4, GPT-4o, GPT-4o Mini, o3-mini
- **Multi-Provider** — Anthropic, OpenAI, and OpenRouter support
- **BYOK** — Bring your own API keys. Dedicated settings page for managing keys per provider
- **Resizable Split View** — Drag to resize PDF and chat panels
- **Persistent Chat** — Conversations are saved per study in localStorage

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), add your API key(s) in Settings, create a study session, and start reading.

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React, TypeScript
- react-pdf / pdfjs-dist for PDF rendering
- react-markdown + rehype-katex for math rendering
- Tailwind CSS
- Lucide icons

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts        # Streaming AI chat (Anthropic + OpenAI + OpenRouter)
│   │   └── pdf/route.ts         # PDF proxy to avoid CORS
│   ├── study/[id]/page.tsx      # Paper reader (split PDF + chat view)
│   ├── settings/page.tsx        # API key management
│   ├── page.tsx                 # Dashboard home (empty state)
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── chat-panel.tsx           # Chat UI with streaming
│   ├── dashboard-layout.tsx     # Sidebar + main content layout
│   ├── markdown-message.tsx     # Safe markdown + KaTeX rendering
│   ├── model-selector.tsx       # Model dropdown
│   ├── new-study-dialog.tsx     # Create study modal
│   ├── pdf-viewer.tsx           # PDF renderer with text selection
│   ├── selection-popover.tsx    # "Ask about this" floating button
│   └── sidebar.tsx              # Studies sidebar with date grouping
└── lib/
    ├── keys.ts                  # localStorage key management
    ├── models.ts                # Model + provider definitions
    ├── studies.ts               # Study CRUD + message persistence
    └── utils.ts                 # Shared utilities
```

## License

MIT
