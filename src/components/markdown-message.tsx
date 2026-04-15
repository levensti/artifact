"use client";

import { useMemo } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  transformWikiLinks,
  wikiSlugFromHref,
} from "@/lib/wiki-link-transform";
import WikiLinkHover from "./wiki-link-hover";

interface MarkdownMessageProps {
  content: string;
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  // Normalize [[slug]] tokens into markdown links so the renderer can
  // pick them up and swap them for rich WikiLinkHover chips. This runs
  // once per content change and is cheap (single regex pass).
  const processed = useMemo(() => transformWikiLinks(content), [content]);

  return (
    <div className="chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: (props) => {
            const slug = wikiSlugFromHref(props.href);
            if (slug) {
              return (
                <WikiLinkHover slug={slug}>{props.children}</WikiLinkHover>
              );
            }
            // Route relative/in-app paths through next/link so citations
            // like [Title](/review/abc) feel native instead of popping a
            // new tab. External URLs still open in a new tab.
            const href = props.href ?? "";
            if (href.startsWith("/")) {
              return <Link href={href}>{props.children}</Link>;
            }
            return <a {...props} target="_blank" rel="noopener noreferrer" />;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
