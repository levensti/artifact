import { BrandGlyph } from "@/components/brand-panel";

export interface LandingFooterProps {
  githubUrl: string;
}

export function LandingFooter({ githubUrl }: LandingFooterProps) {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-6 py-7 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center lg:px-10">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BrandGlyph className="size-2.5" />
          </span>
          <span className="font-semibold tracking-tight text-foreground">
            Artifact
          </span>
        </div>
        <div className="flex items-center gap-5">
          <span className="text-muted-foreground/60">
            © {new Date().getFullYear()} Artifact
          </span>
        </div>
      </div>
    </footer>
  );
}
