/**
 * "5m ago / 3h ago / 2d ago / Mar 12" style relative-time formatting of an
 * ISO-8601 timestamp. Returns the original string unchanged if parsing fails
 * so the UI never shows "NaN ago".
 */
export function formatRelative(stamp: string): string {
  if (!stamp) return "";
  const then = new Date(stamp).getTime();
  if (!Number.isFinite(then)) return stamp;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(stamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
