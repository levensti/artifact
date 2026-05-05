import { MonoLabel } from "@/components/folio";

/**
 * Share section. The journal section showed reading getting recorded;
 * this one shows it getting handed off.
 */
export function LandingShare() {
  return (
    <section id="share" className="py-14">
      <div className="landing-spread">
        <aside className="landing-marg">
          <MonoLabel>Sharing</MonoLabel>
        </aside>
        <div>
          <h2 className="landing-section-title">
            Share your reviews
            <br />
            with a colleague.
          </h2>
          <p
            className="mt-[18px] max-w-[620px] text-[17px] leading-[1.65]"
            style={{
              fontFamily: "var(--font-reading)",
              color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
              textWrap: "pretty",
            }}
          >
            Send a single link. The recipient opens the paper with every
            highlight, every margin note, every chat thread you started. They
            can read it as-is, or import the bundle into their own workspace and
            keep going.
          </p>

          <div className="mt-9 max-w-[620px]">
            <ShareSpecimen />
          </div>

          <ul
            className="mt-7 grid max-w-[620px] grid-cols-1 gap-x-10 gap-y-4 sm:grid-cols-2"
            style={{ listStyle: "none", padding: 0 }}
          >
            <ShareBullet
              title="Reviews"
              body="Share a paper review with all annotations, notes, and chat history."
            />
            <ShareBullet
              title="Journal entries"
              body="Share a session recap or a wiki page so others can see what you learned."
            />
            <ShareBullet
              title="One link, no install"
              body="Recipients open it in a browser. No account needed to read."
            />
            <ShareBullet
              title="Or export as a bundle"
              body="Download a single file and send it however you want."
            />
          </ul>
        </div>
      </div>
    </section>
  );
}

function ShareBullet({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <div
        className="text-[14.5px] font-semibold tracking-[-0.01em] text-foreground"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {title}
      </div>
      <div
        className="mt-1 text-[13.5px] leading-[1.55]"
        style={{
          fontFamily: "var(--font-reading)",
          color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
        }}
      >
        {body}
      </div>
    </li>
  );
}

function ShareSpecimen() {
  return (
    <div
      className="overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-sm)]"
      style={{
        borderColor: "color-mix(in srgb, var(--border) 75%, transparent)",
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground"
        style={{
          letterSpacing: "0.04em",
          borderColor: "color-mix(in srgb, var(--border) 70%, transparent)",
          background: "color-mix(in srgb, var(--reader-mat) 50%, var(--card))",
        }}
      >
        <ShareIcon />
        <span>Share · SWE-bench review</span>
        <span
          className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
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
      <div className="p-4">
        <div
          className="flex items-center gap-2.5 rounded-md border px-3 py-2.5"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 22%, transparent)",
            background:
              "color-mix(in srgb, var(--primary) 4%, var(--background))",
          }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
            aria-hidden
            style={{
              color: "color-mix(in srgb, var(--primary) 70%, transparent)",
            }}
          >
            <path d="M6.5 8.5l3-3M5.5 10.5L4 12a2.5 2.5 0 1 1-3.5-3.5L2 7" />
            <path d="M9.5 5.5L11 4a2.5 2.5 0 1 1 3.5 3.5L13 9" />
          </svg>
          <span
            className="truncate font-mono text-[12.5px]"
            style={{
              color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
            }}
          >
            withartifact.com/share/r-7f3e9a2b
          </span>
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium"
            style={{
              background: "var(--primary)",
              color: "var(--primary-foreground)",
            }}
          >
            <CopyIcon />
            Copy link
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px]">
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
            <Stat>1</Stat> linked journal entry
          </BundleStat>
        </div>
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
