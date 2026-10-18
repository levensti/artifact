/**
 * Loading placeholder for a document: the viewer's toolbar strip, then
 * page-shaped sheets (white, letter-sized, shadowed like real pages) with
 * faint lines where the title and text will be. Every stage of opening a
 * review (data, viewer code, file, first render) shows this same shape, so
 * the document looks like it's arriving rather than a spinner moving around.
 */

/** Faint text lines for a sheet: a title, an author line, then paragraphs
 *  with uneven ends so they read as text. Shared with page slots that
 *  haven't rendered yet. */
export function SheetLines() {
  const paragraph = ["100%", "96%", "99%", "93%", "97%", "58%"];
  return (
    <div
      className="absolute inset-0 flex flex-col px-[11%] pt-[12%] motion-safe:animate-pulse"
      aria-hidden
    >
      <div className="mx-auto h-[1.6%] w-[62%] rounded-full bg-neutral-300/70" />
      <div className="mx-auto mt-[2.2%] h-[1%] w-[34%] rounded-full bg-neutral-200" />
      {[0, 1, 2].map((p) => (
        <div key={p} className="mt-[6%] flex flex-col gap-[1.4%]">
          {paragraph.map((w, i) => (
            <div key={i} className="h-[0.9%] min-h-[3px] rounded-full bg-neutral-200" style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Sheet() {
  return (
    <div
      className="relative w-full shrink-0 bg-white shadow-md"
      style={{ aspectRatio: "8.5 / 11" }}
    >
      <SheetLines />
    </div>
  );
}

export default function PdfSkeleton({
  toolbar = true,
  label = "Loading document",
}: {
  /** Show the toolbar strip (off inside the viewer, which has its own). */
  toolbar?: boolean;
  label?: string;
}) {
  return (
    <div
      className="flex h-full min-h-[200px] flex-col overflow-hidden bg-(--reader-mat)"
      role="status"
      aria-label={label}
    >
      {toolbar ? (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background px-3 sm:h-14 sm:px-4">
          <div className="h-7 w-28 rounded-md border border-border bg-card sm:h-8" />
          <div className="mx-auto hidden h-2.5 w-56 rounded-full bg-muted-foreground/10 md:block" />
          <div className="h-7 w-16 rounded-md border border-border bg-card sm:h-8" />
        </div>
      ) : null}
      {/* Same margins as the viewer's page column, so sheets sit exactly
          where the real pages will. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 py-3 sm:py-4">
        <Sheet />
        <Sheet />
      </div>
    </div>
  );
}
