"use client";

import { useState } from "react";
import { ArrowRight, FileText, Settings, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import SettingsModal from "@/components/settings-modal";

export default function Home() {
  const [url, setUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = url.trim();
    if (!trimmed) return;

    // Validate arxiv URL
    const arxivMatch = trimmed.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
    if (!arxivMatch) {
      setError(
        "Please enter a valid Arxiv URL (e.g., https://arxiv.org/abs/2602.00277)",
      );
      return;
    }

    router.push(`/paper/${arxivMatch[1]}`);
  };

  return (
    <div className="flex flex-col min-h-full">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-accent" />
          <span className="font-semibold text-lg">Paper Copilot</span>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-bg-secondary text-text-secondary hover:text-text-primary text-sm transition-colors"
        >
          <Settings size={16} />
          Settings
        </button>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="max-w-2xl w-full text-center space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-muted text-accent text-sm font-medium">
              <Sparkles size={14} />
              AI-Powered Paper Reading
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
              Read papers with an
              <br />
              <span className="text-accent">AI copilot</span>
            </h1>
            <p className="text-text-secondary text-lg max-w-md mx-auto">
              Paste an Arxiv link, and pair with AI to understand any research
              paper. Select text, ask questions, get instant explanations.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <FileText
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  placeholder="https://arxiv.org/abs/2602.00277"
                  className="w-full bg-bg-secondary border border-border rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-text-muted"
                />
              </div>
              <button
                type="submit"
                className="px-6 py-3.5 rounded-xl bg-accent hover:bg-accent-hover text-white font-medium text-sm transition-colors flex items-center gap-2"
              >
                Open
                <ArrowRight size={16} />
              </button>
            </div>
            {error && <p className="text-danger text-sm text-left">{error}</p>}
          </form>

          <div className="flex items-center justify-center gap-6 text-text-muted text-sm">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              Bring your own API keys
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              Claude &amp; GPT-4o
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-success" />
              Self-hosted &amp; open source
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center text-text-muted text-xs border-t border-border">
        Open source · Self-hosted · API keys stored in your browser
      </footer>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
