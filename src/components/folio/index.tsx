/**
 * Folio primitives — small typographic building blocks shared across the
 * landing page and the in-app surfaces. Kept deliberately small to avoid
 * sliding back into "boutique-newspaper" cosplay: there's no Volume/Folio
 * meta strip, no "Filed under" rule, no § folio numbering. Just two
 * primitives that earn their keep.
 *
 * - MonoLabel: a single mono caps line for kicker labels and section
 *   heads. The defining trait is wide tracking (0.18em) and small size
 *   (10.5px). Use it for *real* labels, not as decoration.
 * - ItalicAccent: italic Inter at the primary tint. Reserved for *one*
 *   noun or short phrase per page that you want the eye to land on. If
 *   you find yourself reaching for it on every CTA, stop.
 */

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Mono kicker label ─────────────────────────────────────────── */

export interface MonoLabelProps {
  children: ReactNode;
  /// Defaults to muted; pass `accent` to render in the primary tint.
  tone?: "muted" | "accent";
  className?: string;
}

export function MonoLabel({
  children,
  tone = "muted",
  className,
}: MonoLabelProps) {
  return (
    <span
      className={cn("font-mono text-[10.5px] uppercase", className)}
      style={{
        letterSpacing: "0.18em",
        color:
          tone === "accent"
            ? "color-mix(in srgb, var(--primary) 80%, transparent)"
            : "color-mix(in srgb, var(--muted-foreground) 75%, transparent)",
      }}
    >
      {children}
    </span>
  );
}

/* ── Italic accent — the "frontier" word ───────────────────────── */

export interface ItalicAccentProps {
  children: ReactNode;
  className?: string;
}

export function ItalicAccent({ children, className }: ItalicAccentProps) {
  return (
    <span
      className={cn(className)}
      style={{
        fontFamily: "var(--font-reading)",
        fontStyle: "italic",
        fontWeight: 500,
        color: "color-mix(in srgb, var(--primary) 88%, transparent)",
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </span>
  );
}
