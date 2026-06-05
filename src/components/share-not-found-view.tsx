import Link from "next/link";
import { ItalicAccent, MonoLabel } from "@/components/folio";

export default function ShareNotFoundView() {
  return (
    <main
      className="grid min-h-screen place-items-center px-6 text-center"
      style={{ background: "var(--reader-mat)" }}
    >
      <div className="max-w-md">
        <span
          className="mx-auto mb-7 flex size-12 items-center justify-center rounded-md bg-card shadow-[var(--shadow-sm)]"
          style={{
            border:
              "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
          }}
        >
          <BrandGlyph className="size-5 text-primary" />
        </span>
        <MonoLabel>Share not found</MonoLabel>
        <h1
          className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] text-foreground"
          style={{ textWrap: "balance" }}
        >
          This share isn&apos;t <ItalicAccent>available.</ItalicAccent>
        </h1>
        <p
          className="mt-4 text-[14px] leading-[1.6]"
          style={{
            fontFamily: "var(--font-reading)",
            color: "color-mix(in srgb, var(--foreground) 72%, transparent)",
          }}
        >
          The link may have been revoked, or the underlying review was deleted
          by its owner.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          Go to Artifact
        </Link>
      </div>
    </main>
  );
}

function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="4 4 24 24" aria-hidden className={className}>
      <polygon points="5,24 12,7 19,24" fill="currentColor" opacity="0.4" />
      <polygon points="13,24 20,12 27,24" fill="currentColor" />
    </svg>
  );
}
