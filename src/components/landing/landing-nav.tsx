"use client";

import Link from "next/link";
import { BrandGlyph } from "@/components/brand-panel";

export interface LandingNavProps {
  signupHref: string;
}

const SECTION_LINKS: Array<{ href: string; label: string }> = [
  { href: "#what", label: "Features" },
  { href: "#principles", label: "Principles" },
  { href: "#open-source", label: "Open source" },
];

/**
 * The "chrome" bar — a sliver of app UI sitting above the folio so the
 * visitor feels they have already arrived inside Artifact. Sticky, blurred,
 * with breadcrumbs pointing into the page being read.
 */
export function LandingNav({ signupHref }: LandingNavProps) {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md border-b"
      style={{
        background: "color-mix(in srgb, var(--reader-mat) 92%, transparent)",
        borderColor: "color-mix(in srgb, var(--border) 75%, transparent)",
      }}
    >
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-4 px-8 py-2.5 text-[12.5px]">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-semibold tracking-tight text-foreground"
          aria-label="Artifact home"
        >
          <span className="flex size-[22px] items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BrandGlyph className="size-3" />
          </span>
          <span>Artifact</span>
        </Link>

        <span className="flex-1" />

        <nav className="hidden items-center gap-1 lg:flex">
          {SECTION_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-md px-2.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href={signupHref}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 active:translate-y-px"
        >
          Get started
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3"
            aria-hidden
          >
            <path d="M5 12L11 6" />
            <path d="M6 6h5v5" />
          </svg>
        </a>
      </div>
    </header>
  );
}
