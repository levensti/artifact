"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import Link from "next/link";

interface WikiMarkdownProps {
  content: string;
  /** Set of known slugs — links to unknown slugs render dimmed. */
  knownSlugs?: Set<string>;
}

/**
 * Preprocess markdown to convert [[slug]] wiki-links into standard links.
 * [[slug]] → [slug](/kb/slug)
 * [[slug|Display Text]] → [Display Text](/kb/slug)
 */
function resolveWikiLinks(markdown: string): string {
  return markdown.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_match, slug: string, label?: string) => {
      const trimSlug = slug.trim();
      const display = label?.trim() || trimSlug;
      return `[${display}](/kb/${trimSlug})`;
    },
  );
}

/** Strip YAML frontmatter from markdown. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("---", 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}

export default function WikiMarkdown({ content, knownSlugs }: WikiMarkdownProps) {
  const processed = resolveWikiLinks(stripFrontmatter(content));

  return (
    <div className="wiki-markdown prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children, ...rest }) => {
            if (href?.startsWith("/kb/")) {
              const slug = href.replace("/kb/", "");
              const exists = !knownSlugs || knownSlugs.has(slug);
              return (
                <Link
                  href={href}
                  className={exists ? "text-primary hover:underline" : "text-muted-foreground/50 cursor-help"}
                  title={exists ? undefined : `Page "${slug}" not yet created`}
                  {...rest}
                >
                  {children}
                </Link>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

export { stripFrontmatter, resolveWikiLinks };
