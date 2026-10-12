"use client";

import Link from "next/link";
import { BrandGlyph } from "@/components/brand-panel";

export interface LandingNavProps {
  signupHref: string;
  signinHref: string;
}

const SECTION_LINKS: Array<{ href: string; label: string }> = [
  { href: "#discover", label: "Discover" },
  { href: "#review", label: "Review" },
  { href: "#share", label: "Share" },
];

/**
 * Floating nav: a compact, content-width bar that hovers just below the top
 * edge, centred, so the cover runs edge to edge behind it. Paper at 80% over
 * a blur, a hairline border, and the ink CTA nested inside the bar.
 *
 * The outer header is a zero-height sticky strip so the bar takes no space
 * in the flow; only the bar itself receives pointer events.
 */
export function LandingNav({ signupHref, signinHref }: LandingNavProps) {
  return (
    <header className="pointer-events-none sticky top-0 z-30 h-0">
      {/* The offset is padding, not margin: a margin here would collapse
          through the zero-height header and the bar would pin flush to the
          top edge once scrolling. */}
      <div className="pt-5">
        <nav
          aria-label="Main"
          className="pointer-events-auto mx-auto flex w-fit max-w-[calc(100%-24px)] items-center gap-1 rounded-xl border border-border p-1.5 backdrop-blur-md"
          style={{
            background: "color-mix(in srgb, var(--card) 80%, transparent)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <Link
            href="/"
            aria-label="Artifact home"
            className="flex h-9 items-center gap-2 rounded-lg pl-1.5 pr-2.5 font-semibold tracking-tight text-foreground transition-colors duration-150 hover:bg-muted"
          >
            <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
              <BrandGlyph className="size-3" />
            </span>
            <span className="text-[14px]">Artifact</span>
          </Link>

          <span
            aria-hidden
            className="mx-1 hidden h-5 w-px bg-border md:block"
          />

          {SECTION_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="hidden h-9 items-center rounded-lg px-3 text-[13.5px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground md:inline-flex"
            >
              {l.label}
            </a>
          ))}

          <span
            aria-hidden
            className="mx-1 hidden h-5 w-px bg-border md:block"
          />

          <a
            href={signinHref}
            className="inline-flex h-9 items-center rounded-lg px-3 text-[13.5px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            Sign in
          </a>
          <a
            href={signupHref}
            className="inline-flex h-9 items-center rounded-lg bg-foreground px-3.5 text-[13.5px] font-medium text-background transition-opacity duration-150 hover:opacity-85"
          >
            Get started
          </a>
        </nav>
      </div>
    </header>
  );
}
