import { ItalicAccent, MonoLabel } from "@/components/folio";

export interface LandingHeroProps {
  signupHref: string;
  githubUrl: string;
}

export function LandingHero({ signupHref, githubUrl }: LandingHeroProps) {
  return (
    <section
      id="cover"
      className="relative px-16 pt-20 pb-14"
      aria-labelledby="cover-title"
    >
      <MonoLabel>Open source · Free to use</MonoLabel>

      <h1 id="cover-title" className="landing-cover-h1 mt-6">
        Explore the
        <span className="frontier">frontier.</span>
      </h1>

      <p
        className="mt-9 max-w-160 text-[19px] leading-[1.6]"
        style={{
          fontFamily: "var(--font-reading)",
          color: "color-mix(in srgb, var(--foreground) 88%, transparent)",
          textWrap: "pretty",
        }}
      >
        Read papers, blogs, and arbitrary PDFs alongside a powerful AI
        assistant. Every concept, every connection, every insight you find, kept
        in{" "}
        <ItalicAccent>
          a personal journal that compounds with you over years
        </ItalicAccent>
        .
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-2.5">
        <a
          href={signupHref}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4.5 text-[13.5px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 active:translate-y-px"
        >
          Get started
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-[13px]"
            aria-hidden
          >
            <path d="M3 8h10" />
            <path d="M9 4l4 4-4 4" />
          </svg>
        </a>
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-transparent px-[18px] text-[13.5px] font-medium text-foreground transition-colors duration-150 hover:bg-muted"
        >
          <GithubMark className="size-[13px]" />
          View on GitHub
        </a>
      </div>

      <p className="mt-6 text-[12.5px] text-muted-foreground/80">
        Free · MIT licensed · Bring your own keys
      </p>
    </section>
  );
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      fill="currentColor"
      className={className}
    >
      <path d="M8 0.5C3.9 0.5 0.5 3.9 0.5 8c0 3.3 2.1 6.1 5.1 7.1.4.1.5-.2.5-.4v-1.3c-2.1.4-2.6-.9-2.6-.9-.3-.9-.8-1.1-.8-1.1-.7-.5.1-.5.1-.5.7.1 1.1.8 1.1.8.7 1.2 1.8.9 2.3.6.1-.5.3-.9.5-1.1-1.7-.2-3.4-.8-3.4-3.7 0-.8.3-1.5.8-2-.1-.2-.3-1 .1-2.1 0 0 .6-.2 2.1.8.6-.2 1.3-.3 2-.3.7 0 1.4.1 2 .3 1.5-1 2.1-.8 2.1-.8.4 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2 0 2.9-1.7 3.5-3.4 3.7.3.2.5.7.5 1.4v2c0 .2.1.5.6.4 3-1 5.1-3.8 5.1-7.1C15.5 3.9 12.1 0.5 8 0.5z" />
    </svg>
  );
}
