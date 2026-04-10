"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, FileWarning } from "lucide-react";
import DOMPurify from "dompurify";

interface WebViewerProps {
  sourceUrl: string;
  onTextExtracted: (text: string) => void;
}

export default function WebViewer({ sourceUrl, onTextExtracted }: WebViewerProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef<string | null>(null);

  const fetchContent = useCallback(async () => {
    if (fetchedRef.current === sourceUrl) return;
    fetchedRef.current = sourceUrl;

    setLoading(true);
    setError(null);
    setHtmlContent(null);

    try {
      const res = await fetch(
        `/api/web-content?url=${encodeURIComponent(sourceUrl)}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to fetch" }));
        throw new Error(data.error || `Request failed: ${res.status}`);
      }

      const data: {
        title: string;
        textContent: string;
        htmlContent: string;
        siteName: string;
        excerpt: string;
      } = await res.json();

      setTitle(data.title);
      setSiteName(data.siteName);
      setHtmlContent(DOMPurify.sanitize(data.htmlContent, {
        ADD_TAGS: ["figure", "figcaption", "picture", "source", "video", "audio", "iframe"],
        ADD_ATTR: ["loading", "decoding", "srcset", "sizes", "media", "allowfullscreen"],
        FORBID_TAGS: ["script", "style"],
      }));
      onTextExtracted(data.textContent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load page");
      fetchedRef.current = null;
    } finally {
      setLoading(false);
    }
  }, [sourceUrl, onTextExtracted]);

  useEffect(() => {
    void fetchContent();
  }, [fetchContent]);

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/40 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 min-w-0">
          {siteName && (
            <span className="text-xs font-medium text-muted-foreground truncate">
              {siteName}
            </span>
          )}
        </div>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          Open original
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Content */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
            <FileWarning className="text-destructive" size={28} />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}
        {htmlContent && (
          <div className="max-w-3xl mx-auto px-8 py-8">
            {title && (
              <h1 className="text-2xl font-bold text-foreground mb-6 leading-tight">
                {title}
              </h1>
            )}
            <div
              className="web-reader-content prose prose-neutral max-w-none
                text-foreground/90
                [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mt-8 [&_h1]:mb-4
                [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-7 [&_h2]:mb-3
                [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2
                [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-4
                [&_ul]:text-sm [&_ul]:mb-4 [&_ul]:pl-5 [&_ul]:list-disc
                [&_ol]:text-sm [&_ol]:mb-4 [&_ol]:pl-5 [&_ol]:list-decimal
                [&_li]:mb-1.5
                [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_blockquote]:my-4
                [&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:my-4
                [&_code]:bg-muted [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs
                [&_pre_code]:bg-transparent [&_pre_code]:p-0
                [&_img]:rounded-lg [&_img]:my-4 [&_img]:max-w-full [&_img]:h-auto
                [&_figure]:my-6 [&_figure]:text-center
                [&_figcaption]:text-xs [&_figcaption]:text-muted-foreground [&_figcaption]:mt-2
                [&_table]:text-sm [&_table]:w-full [&_table]:border-collapse [&_table]:my-4
                [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-left
                [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2
                [&_hr]:border-border [&_hr]:my-6"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
