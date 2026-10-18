import type { ReactNode } from "react";

/** The document title in a viewer toolbar: mono and muted, the same title
 *  bar the landing's workspace miniature shows, optionally led by a
 *  breadcrumb (the paper's project). Hidden on narrow viewports, where the
 *  controls need the room. */
export default function ToolbarTitle({
  title,
  crumb,
}: {
  title?: string | null;
  /** Shown before the title, separated by a slash. */
  crumb?: ReactNode;
}) {
  if (!crumb) {
    return (
      <span
        className="hidden min-w-0 flex-1 truncate text-center font-mono text-[11px] text-muted-foreground md:block"
        style={{ letterSpacing: "0.04em" }}
        title={title ?? undefined}
      >
        {title}
      </span>
    );
  }
  return (
    <span
      className="hidden min-w-0 flex-1 items-center justify-center gap-1 font-mono text-[11px] text-muted-foreground md:flex"
      style={{ letterSpacing: "0.04em" }}
    >
      {crumb}
      <span aria-hidden className="shrink-0 text-muted-foreground/50">
        /
      </span>
      <span className="min-w-0 truncate" title={title ?? undefined}>
        {title}
      </span>
    </span>
  );
}
