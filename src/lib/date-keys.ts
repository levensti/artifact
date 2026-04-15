/** Local-timezone date key helpers for session/digest slugs and grouping. */

/** YYYY-MM-DD in the user's local timezone. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD in the user's local timezone, parsed from an ISO string. */
export function localDateKeyFromIso(iso: string): string {
  return localDateKey(new Date(iso));
}

export function sessionSlugForDate(d: Date = new Date()): string {
  return `session-${localDateKey(d)}`;
}

/**
 * ISO-week identifier: YYYY-Www (e.g. "2026-W15"). Uses the ISO-8601 week
 * definition where week 1 contains the first Thursday of the year.
 */
export function isoWeekKey(d: Date = new Date()): string {
  // Copy and normalize to UTC midnight to sidestep DST.
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7; // Mon=1..Sun=7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum); // nearest Thursday
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

export function weekDigestSlugForDate(d: Date = new Date()): string {
  return `digest-week-${isoWeekKey(d).toLowerCase()}`;
}

/** Start (Monday) and end (Sunday) Dates of the ISO week containing `d`, local time. */
export function isoWeekRange(d: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = start.getDay() || 7;
  start.setDate(start.getDate() - (dayNum - 1));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}
