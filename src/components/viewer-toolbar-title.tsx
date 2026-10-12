/** The document title in a viewer toolbar: mono and muted, the same title
 *  bar the landing's workspace miniature shows. Hidden on narrow viewports,
 *  where the controls need the room. */
export default function ToolbarTitle({ title }: { title?: string | null }) {
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
