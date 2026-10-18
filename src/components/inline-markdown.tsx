"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

/**
 * Light markdown for short model-written prose outside the chat, such as a
 * pick's rationale on a paper card: emphasis, inline code, math, and links.
 * Paragraphs inherit the caller's type styles. Bare arxiv.org/abs links
 * render as the same `arXiv:ID` chip the chat uses. Unlike MarkdownMessage
 * there are no diagrams, charts, or paper-bound citation chips, since a card
 * has no paper to resolve them against.
 */
export default function InlineMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            const arxiv = href?.match(/^https?:\/\/arxiv\.org\/abs\/([^?#\s/]+)/i);
            if (arxiv) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="arxiv-chip"
                >
                  arXiv:{arxiv[1].replace(/v\d+$/, "")}
                </a>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground/70"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
