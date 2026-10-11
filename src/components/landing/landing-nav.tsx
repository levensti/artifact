"use client";

import Link from "next/link";
import { BrandGlyph } from "@/components/brand-panel";

export interface LandingNavProps {
  signupHref: string;
  signinHref: string;
  githubUrl: string;
}

const SECTION_LINKS: Array<{ href: string; label: string }> = [
  { href: "#discover", label: "Discover" },
  { href: "#review", label: "Review" },
  { href: "#share", label: "Share" },
  { href: "#open-source", label: "Open source" },
];

/**
 * Sticky nav on a flat paper bar with a hairline bottom rule. Wordmark and
 * section links on the left, account actions on the right.
 */
export function LandingNav({ signupHref, signinHref, githubUrl }: LandingNavProps) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-border backdrop-blur-md"
      style={{
        background: "color-mix(in srgb, var(--reader-mat) 88%, transparent)",
      }}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1120px] items-center gap-8 px-6 md:px-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-semibold tracking-tight text-foreground"
          aria-label="Artifact home"
        >
          <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
            <BrandGlyph className="size-3" />
          </span>
          <span className="text-[14.5px]">Artifact</span>
        </Link>

        <nav className="hidden items-center gap-6 text-[13.5px] md:flex">
          {SECTION_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="hidden h-8 items-center px-2.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
          >
            GitHub
          </a>
          <a
            href={signinHref}
            className="inline-flex h-8 items-center px-2.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </a>
          <a
            href={signupHref}
            className="inline-flex h-8 items-center rounded-md bg-foreground px-3.5 text-[13px] font-medium text-background transition-opacity duration-150 hover:opacity-85"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}
