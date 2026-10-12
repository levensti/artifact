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

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: "Open anything you want to read",
    body: "arXiv papers, technical blogs, your own PDFs, or any URL. Highlight a passage to ask about it.",
  },
  {
    title: "Discover what to read next",
    body: "Describe a topic and a research agent returns a ranked shortlist, each with a reason to care.",
  },
  {
    title: "Free usage every day",
    body: "A daily allowance on us, no key required. Bring your own Fireworks key when you need more.",
  },
];

export function SignupPitch() {
  return (
    <div className="max-w-md">
      <p className="landing-label">
        <b>[■]</b> Open source research workspace
      </p>
      <h2 className="landing-h2 mt-4">
        Read papers with an assistant that has{" "}
        <span className="text-muted-foreground">the whole text.</span>
      </h2>

      <ol className="landing-grid mt-9 bg-card">
        {FEATURES.map((f, i) => (
          <li key={f.title} className="grid grid-cols-[28px_1fr] gap-x-3 px-4 py-3.5">
            <span
              className="pt-px font-mono text-[11.5px] text-muted-foreground"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <div className="text-[13.5px] font-medium tracking-[-0.006em] text-foreground">
                {f.title}
              </div>
              <p className="mt-0.5 text-[12.5px] leading-[1.5] text-muted-foreground">
                {f.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SigninWelcome() {
  return (
    <div className="max-w-md">
      <p className="landing-label">
        <b>[■]</b> Welcome back
      </p>
      <h2 className="landing-h2 mt-4">
        Pick up{" "}
        <span className="text-muted-foreground">where you left off.</span>
      </h2>
      <p className="landing-lede mt-4">
        Your reviews, notes, and threads are right where you left them.
      </p>

      {/* A margin note, drawn the way the landing's workspace mock draws
          one: quiet proof of what the workspace holds. */}
      <figure
        className="mt-9 rounded-lg border bg-card p-4"
        style={{
          borderColor: "color-mix(in srgb, var(--border) 80%, transparent)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <figcaption
          className="font-mono text-[9.5px] uppercase"
          style={{
            letterSpacing: "0.1em",
            color: "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
          }}
        >
          p. 4 · Margin note
        </figcaption>
        <blockquote
          className="mt-2 text-[13px] italic leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
          }}
        >
          The contamination story feels optimistic: new issues leak into
          pretraining faster than they assume.
        </blockquote>
      </figure>
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
