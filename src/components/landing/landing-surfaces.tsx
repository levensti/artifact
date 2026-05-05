import { MonoLabel } from "@/components/folio";

/**
 * The three surfaces of the workspace — Home, Review, Journal — each shown
 * with a small typeset specimen of the actual UI rather than a screenshot.
 */
export function LandingSurfaces() {
  return (
    <section id="what" className="py-14">
      <div className="landing-spread">
        <aside className="landing-marg">
          <MonoLabel>What it is</MonoLabel>
        </aside>
        <div>
          <h2 className="landing-section-title">
            One workspace. Three surfaces.
          </h2>
          <p
            className="mt-[18px] max-w-[620px] text-[17px] leading-[1.65]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
              textWrap: "pretty",
            }}
          >
            Open a paper from one place. Read it alongside an AI. Find what
            you&apos;ve learned weeks later in a journal that wrote itself.
          </p>

          <div className="mt-10">
            <Surface
              num="01"
              kicker="Home"
              title="Open anything you want to read"
              body="Paste an arXiv link. Drop a PDF. Point at a blog. The page opens on a warm reader mat: cleaned, scrollable, annotatable. Search arXiv right from the picker."
              specimen={<HomeSpecimen />}
            />
            <Surface
              num="02"
              kicker="Review"
              title="Ask the assistant about anything you highlight"
              body="Read in the middle. Take notes on the right. Ask the assistant on the left. Highlight any sentence to ask a question or pin a note. The conversation stays tied to the passage and lives inside the paper."
              specimen={<ReviewSpecimen />}
            />
            <Surface
              num="03"
              kicker="Journal"
              title="Let the journal write itself"
              body="Snapshot a chat. Compose an entry from a prompt. Import a Claude Code session. Reading sessions roll up into daily recaps and weekly digests, cross-linked across the topics you keep returning to."
              specimen={<JournalSpecimen />}
              last
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function Surface({
  num,
  kicker,
  title,
  body,
  specimen,
  last,
}: {
  num: string;
  kicker: string;
  title: React.ReactNode;
  body: React.ReactNode;
  specimen: React.ReactNode;
  last?: boolean;
}) {
  const borderColor = "color-mix(in srgb, var(--border) 70%, transparent)";
  return (
    <article
      className="grid grid-cols-1 gap-x-8 py-7 md:grid-cols-[88px_1fr]"
      style={{
        borderTop: `1px solid ${borderColor}`,
        borderBottom: last ? `1px solid ${borderColor}` : undefined,
      }}
    >
      <div className="flex items-baseline gap-2.5 md:flex-col md:items-start md:gap-2 md:pt-1">
        <span
          className="font-mono text-[10.5px] uppercase"
          style={{
            letterSpacing: "0.18em",
            color:
              "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
            fontFeatureSettings: '"tnum"',
          }}
        >
          {num}
        </span>
        <span
          className="font-sans text-[15px] font-semibold tracking-[-0.012em] text-foreground md:text-[16px]"
        >
          {kicker}
        </span>
      </div>
      <div>
        <h3
          className="m-0 font-sans"
          style={{
            fontSize: "24px",
            fontWeight: 650,
            letterSpacing: "-0.022em",
            color: "var(--foreground)",
            textWrap: "balance",
          }}
        >
          {title}
        </h3>
        <p
          className="mt-3 max-w-[540px] text-[15.5px] leading-[1.65]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 78%, transparent)",
          }}
        >
          {body}
        </p>
        <div className="mt-5">{specimen}</div>
      </div>
    </article>
  );
}

function SpecimenCard({
  label,
  children,
  className = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`max-w-[540px] overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-sm)] ${className}`}
    >
      <div
        className="flex items-center gap-2 border-b px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground"
        style={{
          letterSpacing: "0.04em",
          borderColor:
            "color-mix(in srgb, var(--border) 70%, transparent)",
          background:
            "color-mix(in srgb, var(--reader-mat) 50%, var(--card))",
        }}
      >
        <span
          className="size-[7px] rounded-full"
          style={{ background: "var(--primary)" }}
          aria-hidden
        />
        {label}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function HomeSpecimen() {
  return (
    <SpecimenCard label={<span>artifact · start a review</span>}>
      <div
        className="flex items-center gap-2.5 rounded-md border border-border bg-background px-3 py-2.5 text-[13px] text-foreground"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-3.5 text-muted-foreground"
          aria-hidden
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="m13 13-2.5-2.5" />
        </svg>
        <span
          className="font-mono text-[12.5px]"
          style={{ color: "color-mix(in srgb, var(--foreground) 75%, transparent)" }}
        >
          arxiv.org/abs/2310.06770
        </span>
        <span className="landing-caret" aria-hidden />
        <span
          className="ml-auto rounded-sm px-1.5 py-0.5 text-[10.5px] font-medium"
          style={{
            color: "color-mix(in srgb, var(--primary) 88%, transparent)",
            background: "var(--badge-accent-bg)",
            letterSpacing: "0.02em",
          }}
        >
          arXiv
        </span>
      </div>
      <div
        className="mt-2.5 text-[11.5px]"
        style={{ color: "color-mix(in srgb, var(--muted-foreground) 80%, transparent)" }}
      >
        or drop a PDF · or paste any URL · runs entirely in your browser
      </div>
    </SpecimenCard>
  );
}

function ReviewSpecimen() {
  return (
    <SpecimenCard
      label={
        <span>
          SWE-bench: Can Language Models Resolve Real-World GitHub Issues?
        </span>
      }
    >
      <div
        className="mb-3.5 font-mono text-[10.5px] text-muted-foreground"
        style={{ letterSpacing: "0.06em" }}
      >
        JIMENEZ ET AL. · 2023 · arXiv:2310.06770 · 33 pp.
      </div>
      <p
        className="text-[14px] leading-[1.7]"
        style={{
          fontFamily: "var(--font-reading)",
          color: "color-mix(in srgb, var(--foreground) 90%, transparent)",
        }}
      >
        SWE-bench evaluates language models on{" "}
        <span className="landing-hl-blue">
          2,294 software-engineering problems drawn from real GitHub issues
          <Pill>thread · 4 replies</Pill>
        </span>{" "}
        and corresponding pull requests across 12 popular Python repositories.
        Given a codebase and an issue, a model is tasked with{" "}
        <span className="landing-hl">
          generating a patch that resolves the described problem
        </span>
        . The benchmark is meant to be persistent: drawn from new issues as
        they arise, to resist contamination.
      </p>
    </SpecimenCard>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 align-middle font-sans text-[10px] font-medium"
      style={{
        background: "var(--badge-accent-bg)",
        color: "var(--badge-accent-fg)",
        transform: "translateY(-1px)",
      }}
    >
      <span
        className="size-1 rounded-full"
        style={{ background: "var(--primary)" }}
        aria-hidden
      />
      {children}
    </span>
  );
}

function JournalSpecimen() {
  return (
    <SpecimenCard label={<span>journal · today · jan 14</span>}>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <JCard
          kind="Session"
          date="Jan 14"
          title="Sparse attention is mostly about caches"
          body="You spent ninety minutes on Linear Attention; the bottleneck argument keeps coming back."
          stats={
            <>
              <b>3</b> papers · <b>5</b> moments · <b>2</b> open questions
            </>
          }
          icon={
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-2.5"
              aria-hidden
            >
              <path d="M3 2.5h6.5L13 6v7.5H3z" />
              <path d="M9.5 2.5V6H13" />
            </svg>
          }
        />
        <JCard
          accent
          kind="Digest"
          date="Week 02"
          title="Reasoning vs. retrieval, four papers in"
          body="A weekly synthesis across SWE-bench, Toolformer, Reflexion and ReAct."
          stats={
            <>
              <b>4</b> papers · <b>11</b> moments · <b>1</b> thread
            </>
          }
          icon={
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-2.5"
              aria-hidden
            >
              <path d="M8 1.5l1.5 4 4 1.5-4 1.5L8 12.5 6.5 8.5l-4-1.5 4-1.5z" />
            </svg>
          }
        />
      </div>
    </SpecimenCard>
  );
}

function JCard({
  kind,
  date,
  title,
  body,
  stats,
  icon,
  accent,
}: {
  kind: string;
  date: string;
  title: string;
  body: string;
  stats: React.ReactNode;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg border p-3 font-sans"
      style={{
        background: accent
          ? "color-mix(in srgb, var(--primary) 4%, var(--card))"
          : "var(--card)",
        borderColor: accent
          ? "color-mix(in srgb, var(--primary) 18%, transparent)"
          : "color-mix(in srgb, var(--border) 70%, transparent)",
      }}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-medium text-muted-foreground">
          <span
            className="inline-flex size-[18px] items-center justify-center rounded-md"
            style={{
              background: accent
                ? "color-mix(in srgb, var(--primary) 14%, transparent)"
                : "var(--badge-accent-bg)",
              color: "color-mix(in srgb, var(--primary) 65%, transparent)",
            }}
          >
            {icon}
          </span>
          {kind}
        </span>
        <span
          className="text-[10px]"
          style={{
            color: "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
            fontFeatureSettings: '"tnum"',
          }}
        >
          {date}
        </span>
      </div>
      <h4 className="m-0 text-[12px] font-semibold leading-[1.35] tracking-[-0.005em] text-foreground">
        {title}
      </h4>
      <p
        className="my-1.5 mb-2.5 text-[11px] leading-[1.5]"
        style={{ color: "color-mix(in srgb, var(--muted-foreground) 90%, transparent)" }}
      >
        {body}
      </p>
      <div
        className="text-[9.5px]"
        style={{
          color: "color-mix(in srgb, var(--muted-foreground) 70%, transparent)",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {stats}
      </div>
    </div>
  );
}
