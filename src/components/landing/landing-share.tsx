import { SectionHeader } from "@/components/landing/landing-section";

/**
 * Share — one link hands a colleague the whole read. Copy on the left,
 * the share card on the right.
 */
export function LandingShare() {
  return (
    <section id="share" style={{ background: "var(--reader-mat)" }}>
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-x-16 gap-y-12 px-6 py-20 sm:py-24 md:px-10 lg:grid-cols-[5fr_6fr]">
        <SectionHeader
          num="03"
          kicker="Share"
          title="Send a colleague your read on a paper."
          lede="One link carries the whole bundle — every highlight, every margin note, every chat and deep dive. A colleague imports it into their own workspace and keeps going where you left off."
        />

        <ShareCard />
      </div>
    </section>
  );
}

function ShareCard() {
  return (
    <div
      className="overflow-hidden rounded-xl border bg-card"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 90%, transparent)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-4 py-3 font-mono text-[11px] text-muted-foreground"
        style={{
          letterSpacing: "0.04em",
          borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
          background: "color-mix(in srgb, var(--reader-mat) 50%, var(--card))",
        }}
      >
        <ShareIcon />
        <span>Share · SWE-bench review</span>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-sans text-[10px] font-medium"
          style={{
            background: "color-mix(in srgb, var(--success) 14%, transparent)",
            color: "color-mix(in srgb, var(--success) 90%, transparent)",
            letterSpacing: "0.02em",
          }}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: "var(--success)" }}
            aria-hidden
          />
          Link ready
        </span>
      </div>
      <div className="p-5">
        <div
          className="flex items-center gap-2.5 rounded-md border px-3 py-2.5"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 22%, transparent)",
            background:
              "color-mix(in srgb, var(--primary) 4%, var(--background))",
          }}
        >
          <LinkIcon />
          <span
            className="truncate font-mono text-[12.5px]"
            style={{
              color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
            }}
          >
            withartifact.com/share/r-7f3e9a2b
          </span>
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-sans text-[11px] font-medium"
            style={{
              background: "var(--primary)",
              color: "var(--primary-foreground)",
            }}
          >
            <CopyIcon />
            Copy link
          </span>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px]">
          <BundleStat>
            <Stat>14</Stat> highlights
          </BundleStat>
          <BundleStat>
            <Stat>6</Stat> margin notes
          </BundleStat>
          <BundleStat>
            <Stat>3</Stat> chat threads
          </BundleStat>
          <BundleStat>
            <Stat>2</Stat> deep dives
          </BundleStat>
        </div>

        <div
          className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 border-t pt-4 sm:grid-cols-2"
          style={{
            borderColor: "color-mix(in srgb, var(--border) 60%, transparent)",
          }}
        >
          <ShareBullet
            title="Everything travels"
            body="Annotations, notes, chats, and deep dives arrive intact."
          />
          <ShareBullet
            title="Import and continue"
            body="One click pulls the review into their own workspace."
          />
        </div>
      </div>
    </div>
  );
}

function ShareBullet({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="font-sans text-[13px] font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </div>
      <div
        className="mt-0.5 text-[12px] leading-[1.55]"
        style={{
          fontFamily: "var(--font-reading)",
          color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
        }}
      >
        {body}
      </div>
    </div>
  );
}

function BundleStat({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        color: "color-mix(in srgb, var(--muted-foreground) 90%, transparent)",
        fontFeatureSettings: '"tnum"',
      }}
    >
      {children}
    </span>
  );
}

function Stat({ children }: { children: React.ReactNode }) {
  return (
    <b
      className="font-semibold"
      style={{
        color: "color-mix(in srgb, var(--foreground) 78%, transparent)",
      }}
    >
      {children}
    </b>
  );
}

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3"
      aria-hidden
      style={{
        color: "color-mix(in srgb, var(--primary) 65%, transparent)",
      }}
    >
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="3.5" r="2" />
      <circle cx="12" cy="12.5" r="2" />
      <path d="M5.7 7.1l4.6-2.7M5.7 8.9l4.6 2.7" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
      aria-hidden
      style={{
        color: "color-mix(in srgb, var(--primary) 70%, transparent)",
      }}
    >
      <path d="M6.5 8.5l3-3M5.5 10.5L4 12a2.5 2.5 0 1 1-3.5-3.5L2 7" />
      <path d="M9.5 5.5L11 4a2.5 2.5 0 1 1 3.5 3.5L13 9" />
    </svg>
  );
}

function CopyIcon() {
  return (
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
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" />
    </svg>
  );
}
