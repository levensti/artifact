"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, GripVertical, Search } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import KbPageCard from "@/components/kb-page-card";
import KbChatPanel from "@/components/kb-chat-panel";
import {
  hydrateClientStore,
  loadWikiPages,
  searchWikiPagesClient,
} from "@/lib/client-data";
import { KB_UPDATED_EVENT } from "@/lib/storage-events";
import type { WikiPage, WikiPageType } from "@/lib/kb-types";
import { WIKI_PAGE_TYPES } from "@/lib/kb-types";
import type { Model } from "@/lib/models";
import { getSavedSelectedModel, saveSelectedModel } from "@/lib/keys";

const TYPE_LABELS: Record<WikiPageType, string> = {
  concept: "Concepts",
  method: "Methods",
  result: "Results",
  "paper-summary": "Paper Summaries",
  topic: "Topics",
};

export default function KbPage() {
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WikiPage[] | null>(null);
  const [version, setVersion] = useState(0);
  const [panelWidth, setPanelWidth] = useState(400);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);

  useEffect(() => {
    void hydrateClientStore().then(() => {
      setReady(true);
      const saved = getSavedSelectedModel();
      if (saved) setSelectedModel(saved);
    });
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(KB_UPDATED_EVENT, bump);
    return () => window.removeEventListener(KB_UPDATED_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void loadWikiPages().then(setPages);
  }, [ready, version]);

  const handleModelChange = useCallback((model: Model | null) => {
    setSelectedModel(model);
    void saveSelectedModel(model);
  }, []);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      void searchWikiPagesClient(searchQuery.trim()).then(setSearchResults);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const grouped = useMemo(() => {
    const display = searchResults ?? pages;
    const byType = new Map<WikiPageType, WikiPage[]>();
    for (const p of display) {
      const list = byType.get(p.pageType) ?? [];
      list.push(p);
      byType.set(p.pageType, list);
    }
    return WIKI_PAGE_TYPES
      .filter((t) => byType.has(t))
      .map((t) => ({ type: t, label: TYPE_LABELS[t], pages: byType.get(t)! }));
  }, [pages, searchResults]);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(320, Math.min(700, newWidth)));
    };
    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  if (!ready) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading…
        </div>
      </DashboardLayout>
    );
  }

  if (pages.length === 0 && !searchQuery) {
    return (
      <DashboardLayout>
        <div className="flex h-full overflow-hidden">
          {/* Empty state */}
          <div className="flex-1 flex items-center justify-center px-6 bg-background">
            <div className="max-w-md text-center space-y-6">
              <div className="mx-auto size-16 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/8 to-primary/3 flex items-center justify-center">
                <BookOpen size={28} className="text-primary" strokeWidth={1.5} />
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Knowledge Base
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
                  Your personal wiki of compiled knowledge. As you read papers
                  and chat with the assistant, concepts, methods, and insights
                  will be distilled here — compounding with every paper you read.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-muted-foreground/60 text-xs">
                <span>Knowledge that compounds</span>
                <span className="size-0.5 rounded-full bg-muted-foreground/35" />
                <span>LLM-maintained wiki</span>
                <span className="size-0.5 rounded-full bg-muted-foreground/35" />
                <span>Cross-paper synthesis</span>
              </div>
            </div>
          </div>

          {/* Chat panel */}
          <div
            onMouseDown={handleMouseDown}
            className={`relative w-1 cursor-col-resize flex items-center justify-center shrink-0 transition-colors ${isDragging ? "bg-primary/30" : "bg-border/80 hover:bg-muted-foreground/25"}`}
          >
            <div className="absolute p-0.5 rounded-md bg-card border border-border/90 opacity-0 hover:opacity-100 transition-opacity shadow-sm">
              <GripVertical size={10} className="text-muted-foreground" />
            </div>
          </div>
          <div
            className="shrink-0 border-l border-border/80 overflow-hidden"
            style={{ width: `${panelWidth}px` }}
          >
            <KbChatPanel
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
            />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full overflow-hidden">
        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
          {/* Header */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
            <BookOpen className="size-4 text-primary" strokeWidth={2} />
            <h1 className="text-sm font-semibold tracking-tight text-foreground">
              Knowledge Base
            </h1>
            <span className="rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground font-medium">
              {pages.length} page{pages.length !== 1 ? "s" : ""}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search pages…"
                  className="h-8 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary/40"
                />
              </div>
            </div>
          </header>

          {/* Page list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
            {searchResults !== null && searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No pages matching &ldquo;{searchQuery}&rdquo;
              </p>
            )}
            {grouped.map((group) => (
              <div key={group.type} className="mb-6 last:mb-0">
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </h2>
                <div className="grid gap-2">
                  {group.pages.map((page) => (
                    <KbPageCard key={page.id} page={page} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div
          onMouseDown={handleMouseDown}
          className={`relative w-1 cursor-col-resize flex items-center justify-center shrink-0 transition-colors ${isDragging ? "bg-primary/30" : "bg-border/80 hover:bg-muted-foreground/25"}`}
        >
          <div className="absolute p-0.5 rounded-md bg-card border border-border/90 opacity-0 hover:opacity-100 transition-opacity shadow-sm">
            <GripVertical size={10} className="text-muted-foreground" />
          </div>
        </div>

        {/* Chat panel */}
        <div
          className="shrink-0 border-l border-border/80 overflow-hidden"
          style={{ width: `${panelWidth}px` }}
        >
          <KbChatPanel
            selectedModel={selectedModel}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
