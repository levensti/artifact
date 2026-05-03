/**
 * The root <body> is `overflow-hidden` to keep the PDF reader pinned to the
 * viewport. The landing page needs to scroll, so it owns its own scroll
 * container — same pattern as `src/app/page.tsx`.
 */
export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      id="landing-scroll"
      className="h-full overflow-y-auto bg-background text-foreground"
    >
      {children}
    </div>
  );
}
