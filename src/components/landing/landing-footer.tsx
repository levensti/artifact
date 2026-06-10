import Link from "next/link";
import { BrandGlyph } from "@/components/brand-panel";

export interface LandingFooterProps {
  signupHref: string;
  githubUrl: string;
}

export function LandingFooter({ signupHref, githubUrl }: LandingFooterProps) {
  return (
    <footer className="bg-background py-10 font-sans text-[12px] text-muted-foreground">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-x-14 gap-y-6 px-6 md:grid-cols-[1fr_auto] md:items-center md:px-10">
        <div className="flex items-center gap-2.5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground"
            aria-label="Artifact home"
          >
            <span className="flex size-[22px] items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BrandGlyph className="size-3" />
            </span>
            <span>Artifact</span>
          </Link>
          <span
            className="text-[12px]"
            style={{
              color:
                "color-mix(in srgb, var(--muted-foreground) 80%, transparent)",
            }}
          >
            · Explore the frontier · MIT licensed
          </span>
        </div>

        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <a href={signupHref} className="hover:text-foreground">
            Get started
          </a>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:text-foreground"
          >
            GitHub
          </a>
          <span
            className="text-[11px]"
            style={{
              color:
                "color-mix(in srgb, var(--muted-foreground) 60%, transparent)",
            }}
          >
            © {new Date().getFullYear()}
          </span>
        </nav>
      </div>
    </footer>
  );
}
