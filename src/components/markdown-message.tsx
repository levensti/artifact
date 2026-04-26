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
import {
  citationFromHref,
  transformCitations,
} from "@/lib/citation-transform";
import WikiLinkHover from "./wiki-link-hover";
import CitationChip from "./citation-chip";
import { useSettingsOpenerOptional } from "./settings-opener-context";

interface MarkdownMessageProps {
  content: string;
}

export default function MarkdownMessage({ content }: MarkdownMessageProps) {
  // Normalize [[slug]] tokens and (§N) / (Fig. N) / (Ref. [key]) citation
  // tokens into markdown links so the renderer can pick them up and swap
  // them for rich chip components. Runs once per content change.
  const processed = useMemo(
    () => transformCitations(transformWikiLinks(content)),
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
            // Used by the agent to deep-link users to "add a Brave key" etc.
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
