/**
 * "5m ago / 3h ago / 2d ago / Mar 12" style relative-time formatting.
 *
 * Accepts either an ISO-8601 string or a `"YYYY-MM-DD HH:MM"` log-stamp
 * (the format used by the wiki log.md append-only log). Returns the
 * original string unchanged if parsing fails so the UI never shows
 * "NaN ago".
 */
export function formatRelative(stamp: string): string {
  if (!stamp) return "";
  // Accept "YYYY-MM-DD HH:MM" as UTC to match how log.md writes it.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp)
    ? stamp.replace(" ", "T") + ":00Z"
    : stamp;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return stamp;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
