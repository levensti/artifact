"use client";

import Link from "next/link";
import { BrandGlyph } from "@/components/brand-panel";
import { ArrowRight } from "@/components/landing/landing-icons";

export interface LandingNavProps {
  signupHref: string;
}

/// Numbered links mirror the section kickers (01 Discover, 02 Review,
/// 03 Share); "Open source" is the un-numbered principles section.
const SECTION_LINKS: Array<{ href: string; num?: string; label: string }> = [
  { href: "#discover", num: "01", label: "Discover" },
  { href: "#review", num: "02", label: "Review" },
  { href: "#share", num: "03", label: "Share" },
  { href: "#open-source", label: "Open source" },
];

/**
 * Sticky nav on the reader mat. Tripartite: wordmark left, the section
 * links (set in the same numbered-mono voice as the section kickers)
 * centered, one CTA right.
 */
export function LandingNav({ signupHref }: LandingNavProps) {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md border-b"
      style={{
        background: "color-mix(in srgb, var(--reader-mat) 92%, transparent)",
        borderColor: "color-mix(in srgb, var(--border) 90%, transparent)",
      }}
    >
      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-[1fr_auto_1fr] items-center px-6 py-3 md:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 justify-self-start font-semibold tracking-tight text-foreground"
          aria-label="Artifact home"
        >
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BrandGlyph className="size-3.5" />
          </span>
          <span className="text-[15px]">Artifact</span>
        </Link>

        <nav
          className="col-start-2 hidden items-center gap-1 font-mono text-[11px] uppercase lg:flex"
          style={{ letterSpacing: "0.14em" }}
        >
          {SECTION_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="group rounded-md px-3 py-2 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              {l.num && (
                <span
                  className="mr-1.5 transition-colors duration-150"
                  style={{
                    color: "color-mix(in srgb, var(--primary) 55%, transparent)",
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  {l.num}
                </span>
              )}
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href={signupHref}
          className="col-start-3 inline-flex h-9 items-center gap-2 justify-self-end rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 active:translate-y-px"
        >
          Get started
          <ArrowRight className="size-3" />
        </a>
      </div>
    </header>
  );
}
