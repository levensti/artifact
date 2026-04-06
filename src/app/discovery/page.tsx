"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { BookOpen, Compass } from "lucide-react";
import DashboardLayout from "@/components/dashboard-layout";
import {
  hydrateClientStore,
  getWikiArticlesSnapshot,
} from "@/lib/client-data";
import { WIKI_UPDATED_EVENT } from "@/lib/wiki";
import type { WikiArticle } from "@/lib/wiki";

/* ── Category colors ── */

const CATEGORY_BG: Record<string, string> = {
  concepts: "#3b82f6",
  methods: "#10b981",
  architectures: "#8b5cf6",
  datasets: "#f59e0b",
  comparisons: "#f43f5e",
  theory: "#06b6d4",
};

function categoryColor(cat: string): string {
  return CATEGORY_BG[cat] ?? "#6b7280";
}

/* ── Layout: simple circle/grid ── */

function layoutArticles(articles: WikiArticle[]): Node[] {
  const count = articles.length;
  if (count === 0) return [];

  // Arrange in a circle for small counts, grid for larger
  if (count <= 12) {
    const radius = Math.max(180, count * 30);
    const cx = 400;
    const cy = 300;
    return articles.map((a, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return {
        id: a.slug,
        position: {
          x: cx + radius * Math.cos(angle) - 70,
          y: cy + radius * Math.sin(angle) - 20,
        },
        data: { label: a.title, article: a },
        style: {
          background: categoryColor(a.category),
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          padding: "8px 14px",
          fontSize: "12px",
          fontWeight: 500,
          maxWidth: "160px",
          textAlign: "center" as const,
          cursor: "pointer",
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
        },
      };
    });
  }

  // Grid layout for larger counts
  const cols = Math.ceil(Math.sqrt(count));
  return articles.map((a, i) => ({
    id: a.slug,
    position: {
      x: (i % cols) * 220 + 50,
      y: Math.floor(i / cols) * 100 + 50,
    },
    data: { label: a.title, article: a },
    style: {
      background: categoryColor(a.category),
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      padding: "8px 14px",
      fontSize: "12px",
      fontWeight: 500,
      maxWidth: "160px",
      textAlign: "center" as const,
      cursor: "pointer",
      boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    },
  }));
}

function buildEdges(articles: WikiArticle[]): Edge[] {
  const slugSet = new Set(articles.map((a) => a.slug));
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const a of articles) {
    for (const related of a.relatedSlugs) {
      if (!slugSet.has(related)) continue;
      const key = [a.slug, related].sort().join("↔");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: `${a.slug}-${related}`,
        source: a.slug,
        target: related,
        style: { stroke: "#94a3b8", strokeWidth: 1.5, opacity: 0.5 },
        animated: false,
      });
    }
  }
  return edges;
}

/* ── Legend ── */

function CategoryLegend({ categories }: { categories: string[] }) {
  if (categories.length === 0) return null;
  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-2 rounded-lg border border-border bg-background/90 backdrop-blur-sm px-3 py-2">
      {categories.map((cat) => (
        <div key={cat} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: categoryColor(cat) }}
          />
          <span className="text-[10px] text-muted-foreground capitalize">
            {cat}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Page ── */

export default function DiscoveryPage() {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const router = useRouter();

  useEffect(() => {
    void hydrateClientStore().then(() => setReady(true));
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(WIKI_UPDATED_EVENT, bump);
    return () => {
      window.removeEventListener(WIKI_UPDATED_EVENT, bump);
    };
  }, []);

  void version;

  const articles = useMemo(() => {
    void version;
    return ready ? getWikiArticlesSnapshot() : [];
  }, [ready, version]);

  const categories = useMemo(
    () => [...new Set(articles.map((a) => a.category))].sort(),
    [articles],
  );

  const initialNodes = useMemo(() => layoutArticles(articles), [articles]);
  const initialEdges = useMemo(() => buildEdges(articles), [articles]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes/edges when articles change
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      router.push(`/wiki?article=${encodeURIComponent(node.id)}`);
    },
    [router],
  );

  if (!ready) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Loading…
        </div>
      </DashboardLayout>
    );
  }

  if (articles.length === 0) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-full px-6 bg-background">
          <div className="max-w-md text-center space-y-8">
            <div className="mx-auto size-16 rounded-xl border border-border bg-card flex items-center justify-center">
              <Compass size={28} className="text-primary" strokeWidth={1.5} />
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Discover
                </h1>
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Your knowledge map, compiled from papers
                </p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
                Your knowledge wiki is empty. Start reviewing papers and
                chatting with the assistant — concept articles will be
                compiled automatically and appear here as an interactive map.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-muted-foreground/70 text-xs">
              <span>LLM-compiled concepts</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Cross-paper synthesis</span>
              <span className="size-0.5 rounded-full bg-muted-foreground/35" />
              <span>Built as you learn</span>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex h-full flex-col overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <Compass className="size-4 text-primary" strokeWidth={2} />
          <h1 className="text-sm font-semibold tracking-tight text-foreground">
            Discover
          </h1>
          <span className="rounded-full bg-muted px-2 py-px text-[10px] tabular-nums text-muted-foreground font-medium">
            {articles.length} concept{articles.length !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => router.push("/wiki")}
            className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <BookOpen className="size-3.5" />
            Browse wiki
          </button>
        </header>
        <div className="flex-1 min-h-0 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.3}
            maxZoom={2}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          <CategoryLegend categories={categories} />
        </div>
      </div>
    </DashboardLayout>
  );
}
