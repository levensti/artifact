/** Canonical id for matching (lowercase, no version suffix). */
export function normalizeArxivId(raw: string): string {
  return raw.trim().toLowerCase().replace(/v\d+$/i, "");
}
