"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
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
import {
  citationFromHref,
  transformCitations,
} from "@/lib/citation-transform";
import WikiLinkHover from "./wiki-link-hover";
import CitationChip from "./citation-chip";
import MermaidDiagram from "./mermaid-diagram";
import { useSettingsOpenerOptional } from "./settings-opener-context";
import {
  isMermaidClass,
  mermaidSource,
} from "@/lib/diagram/fence";

// Fenced blocks (```…``` / ~~~…~~~, incl. an unterminated trailing fence
// while streaming) and inline `code`. Captured so split() keeps them.
const CODE_SEGMENT_RE =
  /(```[\s\S]*?```|```[\s\S]*$|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

/**
 * Apply a text transform everywhere EXCEPT inside code. Citation/wiki-link
 * rewriting must not touch fenced or inline code — otherwise a Mermaid node
 * label like "Fig. 1" or "Section 3" gets turned into a markdown link inside
 * the diagram source and the diagram no longer parses.
 */
function transformOutsideCode(
  content: string,
  fn: (text: string) => string,
): string {
  return content
    .split(CODE_SEGMENT_RE)
    .map((part, i) => (i % 2 === 0 ? fn(part) : part))
    .join("");
}

/**
 * Signals that the markdown being rendered is still streaming in. Diagrams
 * read this to show a placeholder instead of trying to render a half-written
 * (and therefore broken) Mermaid block on every token. The streaming chat
 * bubble wraps its content in <MarkdownStreamingBoundary>.
 */
const MarkdownStreamingContext = createContext(false);

export function MarkdownStreamingBoundary({ children }: { children: ReactNode }) {
  return (
    <MarkdownStreamingContext.Provider value={true}>
      {children}
    </MarkdownStreamingContext.Provider>
  );
}

interface MarkdownMessageProps {
  content: string;
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  const streaming = useContext(MarkdownStreamingContext);
  // Normalize [[slug]] tokens and (§N) / (Fig. N) / (Ref. [key]) citation
  // tokens into markdown links so the renderer can pick them up and swap
  // them for rich chip components. Runs once per content change.
  const processed = useMemo(
    () =>
      transformOutsideCode(content, (text) =>
        transformCitations(transformWikiLinks(text)),
      ),
    [content],
  );
  const settingsOpener = useSettingsOpenerOptional();

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
            const citation = citationFromHref(props.href);
            if (citation) {
              return (
                <CitationChip href={props.href!}>
                  {props.children}
                </CitationChip>
              );
            }
            // app://settings — render as a button-styled link that opens
            // the Settings dialog when an opener is available in context.
            // Used by the agent to deep-link users to "add an Exa key" etc.
            if (props.href === "app://settings" && settingsOpener) {
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    settingsOpener.openSettings();
                  }}
                  className="settings-link"
                >
                  {props.children}
                </button>
              );
            }
            // arXiv abstract pages — render as a compact mono chip so
            // bare arxiv.org/abs/ID links stop dominating prose lists of
            // related work. Strips trailing version (v1, v2…) from the
            // displayed ID; the link itself still points at the original.
            const arxivMatch = props.href?.match(
              /^https?:\/\/arxiv\.org\/abs\/([^?#\s/]+)/i,
            );
            if (arxivMatch) {
              const id = arxivMatch[1].replace(/v\d+$/, "");
              return (
                <a
                  href={props.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="arxiv-chip"
                >
                  arXiv:{id}
                </a>
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
          // Wrap tables so wide ones scroll horizontally instead of
          // blowing out the panel width.
          table: ({ children }) => (
            <div className="chat-md-table-wrap">
              <table>{children}</table>
            </div>
          ),
          // A ```mermaid block renders as a diagram (no code-block chrome);
          // every other fenced block keeps the normal <pre> styling.
          pre: ({ children }) => {
            const only = Array.isArray(children) ? children[0] : children;
            const cls =
              only && typeof only === "object" && "props" in only
                ? (only as { props?: { className?: unknown } }).props?.className
                : undefined;
            if (isMermaidClass(cls)) return <>{children}</>;
            return <pre>{children}</pre>;
          },
          code: ({ className, children }) => {
            if (isMermaidClass(className)) {
              return (
                <MermaidDiagram
                  code={mermaidSource(className, children)}
                  streaming={streaming}
                />
              );
            }
            return <code className={className as string}>{children}</code>;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
