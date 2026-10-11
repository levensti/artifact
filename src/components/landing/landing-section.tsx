/**
 * Shared section anatomy: a bracketed mono label ("[01] Discover"), a
 * display heading, and a muted lede.
 */
export function SectionHeader({
  num,
  kicker,
  title,
  lede,
}: {
  num: string;
  kicker: string;
  title: React.ReactNode;
  lede: React.ReactNode;
}) {
  return (
    <header>
      <p className="landing-label">
        <b>[{num}]</b> {kicker}
      </p>
      <h2 className="landing-h2 mt-4">{title}</h2>
      <p className="landing-lede mt-4 max-w-[520px]">{lede}</p>
    </header>
  );
}
