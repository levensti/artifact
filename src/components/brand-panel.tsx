/**
 * Shared marketing-side panel reused by `/signin`, `/signup`, and the
 * public share-landing pages. Same anatomy as the landing page: flat paper,
 * hairline rules, a bracketed mono label over a sans display heading, and a
 * spec-sheet grid instead of icon tiles. The body is configurable so each
 * surface can pitch in its own voice.
 */

export interface BrandPanelProps {
  /// Body of the panel, usually a `<SignupPitch />` or `<SigninWelcome />`.
  /// Sits between the brand mark (top) and the footer (bottom).
  children: React.ReactNode;
}

export function BrandPanel({ children }: BrandPanelProps) {
  return (
    <section
      className="relative hidden border-r border-border text-foreground md:flex md:flex-col md:justify-between md:px-12 md:py-10 lg:px-14 lg:py-12"
      style={{ background: "var(--reader-mat)" }}
    >
      <header className="flex items-center gap-2">
        <BrandMark />
      </header>

      {children}

      <footer className="landing-label">
        © {new Date().getFullYear()} Artifact · MIT licensed
      </footer>
    </section>
  );
}

/** The wordmark as the landing nav draws it: indigo tile + name. */
export function BrandMark() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-foreground">
      <span className="flex size-[22px] items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
        <BrandGlyph className="size-3" />
      </span>
      <span className="text-[14.5px]">Artifact</span>
    </span>
  );
}

/** What Artifact does, in the order a new reader meets it. */
const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: "Answers that cite the page",
    body: "Start a review of an arXiv paper, a PDF, or any web page and ask about it. Every answer links back to the passage it came from, and a highlight starts a thread pinned to that spot.",
  },
  {
    title: "Skim before you commit",
    body: "Get an interactive overview of a whole paper or article in about a minute, kept beside it so you can jump straight to the sections that matter.",
  },
  {
    title: "A question becomes a project",
    body: "Describe what you want to learn and a research agent writes a brief with a ranked reading list, filed in a project alongside your reviews.",
  },
  {
    title: "Free to start",
    body: "A daily allowance on us, no API key needed. Add your own Fireworks key when you want more.",
  },
];

/** What a returning reader's account holds, so signing in has a reason. */
const SAVED: Array<{ title: string; body: string }> = [
  {
    title: "Reviews",
    body: "Your highlights, notes, and conversations, on the page where you left them.",
  },
  {
    title: "Projects",
    body: "Research briefs, reading lists, and the reviews filed with them.",
  },
  {
    title: "Artifacts",
    body: "Overviews and explainers built from what you read.",
  },
];

/** A spec-sheet list: title over a line of detail, hairline-separated. */
function SpecList({ items }: { items: Array<{ title: string; body: string }> }) {
  return (
    <ul className="landing-grid mt-9 bg-card">
      {items.map((f) => (
        <li key={f.title} className="px-4 py-3.5">
          <div className="text-[13.5px] font-medium tracking-[-0.006em] text-foreground">
            {f.title}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
            {f.body}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function SignupPitch() {
  return (
    <div className="max-w-md">
      <p className="landing-label">
        <b>[■]</b> Open source research workspace
      </p>
      <h2 className="landing-h2 mt-4">
        Understand what you read faster, with sources you can check.
      </h2>
      <SpecList items={FEATURES} />
    </div>
  );
}

export function SigninWelcome() {
  return (
    <div className="max-w-md">
      <p className="landing-label">
        <b>[■]</b> Your workspace
      </p>
      <h2 className="landing-h2 mt-4">Pick up where you left off.</h2>
      <p className="landing-lede mt-4">
        Everything you read and build in Artifact is saved to your account.
      </p>
      <SpecList items={SAVED} />
    </div>
  );
}

export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="4 4 24 24" aria-hidden className={className}>
      {/* Two peaks: the back/left peak is lighter (opacity), the front/right
          peak full — monochrome so it inherits whatever color the context
          paints (currentColor). The true periwinkle + navy live in the app
          icon (src/app/icon.svg). */}
      <polygon points="5,24 12,7 19,24" fill="currentColor" opacity="0.4" />
      <polygon points="13,24 20,12 27,24" fill="currentColor" />
    </svg>
  );
}
