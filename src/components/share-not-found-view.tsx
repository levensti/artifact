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
      <path
        d="M 20.5 11.5 Q 16 15, 8 23 Q 7 24, 7.5 24.5 Q 8 25, 9 24 Q 17 16, 21.5 12.5 Z"
        fill="currentColor"
        opacity="0.4"
      />
      <circle cx="22" cy="10" r="3.2" fill="currentColor" />
    </svg>
  );
}
