/**
 * Shared marketing-side panel reused by `/signin`, `/signup`, and the
 * public share-landing pages. The content body is configurable so each
 * surface can pitch in its own voice while inheriting the gradient,
 * brand glyph, and footer chrome.
 */

import { BookOpen, KeyRound, PenLine } from "lucide-react";

export interface BrandPanelProps {
  /// Body of the panel — usually a `<SignupPitch />` or `<SigninWelcome />`.
  /// Sits between the brand mark (top) and the copyright (bottom).
  children: React.ReactNode;
}

export function BrandPanel({ children }: BrandPanelProps) {
  return (
    <section className="relative hidden overflow-hidden bg-primary text-primary-foreground md:flex md:flex-col md:justify-between md:px-12 md:py-10 lg:px-14 lg:py-12">
      <svg
        viewBox="4 4 24 24"
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 size-[460px] opacity-[0.08]"
      >
        <path
          d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
          fill="currentColor"
        />
        <circle cx="22" cy="10" r="3.2" fill="currentColor" />
      </svg>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_85%,rgba(255,255,255,0.10),transparent_55%),radial-gradient(circle_at_85%_5%,rgba(255,255,255,0.05),transparent_50%)]"
      />

      <header className="relative flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10 backdrop-blur-sm">
          <BrandGlyph className="size-[18px]" />
        </span>
        <span className="text-base font-semibold tracking-tight">Artifact</span>
      </header>

      {children}

      <footer className="relative flex items-center justify-between text-xs text-primary-foreground/55">
        <span>© {new Date().getFullYear()} Artifact</span>
      </footer>
    </section>
  );
}

export function SignupPitch() {
  return (
    <div className="relative max-w-md">
      <h2 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.03em]">
        Push the{" "}
        <span
          className="text-primary-foreground/85"
          style={{
            fontFamily: "var(--font-reading)",
            fontStyle: "italic",
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          frontier.
        </span>
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-primary-foreground/70">
        Read papers, blogs, and arbitrary PDFs alongside a powerful AI
        assistant. Build a personal journal that compounds with you, year
        after year.
      </p>

      <ul className="mt-9 space-y-5">
        <Feature
          icon={<BookOpen strokeWidth={1.6} className="size-3.75" />}
          title="Open anything you want to read"
        >
          arXiv papers, technical blogs, your own PDFs, or any URL. Highlight a
          passage to ask your assistant about it.
        </Feature>
        <Feature
          icon={<PenLine strokeWidth={1.6} className="size-3.75" />}
          title="A journal you can come back to"
        >
          Snapshot a chat, draft an entry from your reading, or import a Claude
          Code session. Look back on every concept and connection, weeks later.
        </Feature>
        <Feature
          icon={<KeyRound strokeWidth={1.6} className="size-3.75" />}
          title="Bring your own keys"
        >
          Anthropic, OpenAI, xAI, or any OpenAI-compatible API. Or run locally
          with Ollama, LM Studio, or llama.cpp.
        </Feature>
      </ul>
    </div>
  );
}

export function SigninWelcome() {
  return (
    <div className="relative max-w-md">
      <h2 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.03em]">
        Welcome back.
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-primary-foreground/70">
        Pick up where you left off. Your annotations, journal, and chats are
        right where you left them.
      </p>
    </div>
  );
}

export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="4 4 24 24" aria-hidden className={className}>
      <path
        d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
        fill="currentColor"
        opacity="0.4"
      />
      <circle cx="22" cy="10" r="3.2" fill="currentColor" />
    </svg>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-foreground/10 text-primary-foreground/85">
        {icon}
      </span>
      <div className="flex-1">
        <div className="text-[13px] font-semibold tracking-tight">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-primary-foreground/65">
          {children}
        </div>
      </div>
    </li>
  );
}
