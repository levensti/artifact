# Paper Copilot

AI-powered research paper reading companion. Paste an Arxiv link, read the paper with a built-in PDF viewer, and pair with an AI to understand it — select text, ask questions, get instant explanations.

## Features

- **PDF Viewer** — Renders Arxiv papers with full text selection, zoom, and page navigation
- **AI Chat** — Ask questions about the paper with full-text context provided to the model
- **Text Selection → Ask** — Select any passage in the PDF, click "Ask about this" to get a targeted explanation
- **Multi-Model** — Switch between Claude (Sonnet 4, Opus 4) and OpenAI (GPT-4o, GPT-4o Mini, o3-mini)
- **BYOK** — Bring your own API keys. Keys are stored in your browser's localStorage and proxied through the app's API routes to call providers. Self-host for full control
- **Resizable Split View** — Drag to resize the PDF and chat panels

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), add your API key(s) in Settings, paste an Arxiv URL, and start reading.

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React, TypeScript
- react-pdf / pdfjs-dist for PDF rendering
- Tailwind CSS
- Lucide icons

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts    # Streaming AI chat (Anthropic + OpenAI)
│   │   └── pdf/route.ts     # PDF proxy to avoid CORS
│   ├── paper/[id]/page.tsx  # Paper reader (split PDF + chat view)
│   ├── page.tsx             # Landing page
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── chat-panel.tsx       # Chat UI with streaming
│   ├── markdown-message.tsx # Safe markdown rendering (react-markdown)
│   ├── model-selector.tsx   # Model dropdown
│   ├── pdf-viewer.tsx       # PDF renderer with text selection
│   ├── selection-popover.tsx # "Ask about this" floating button
│   └── settings-modal.tsx   # API key management
└── lib/
    ├── keys.ts              # localStorage key management
    ├── models.ts            # Model definitions
    └── utils.ts             # Shared utilities
```

## License

MIT
