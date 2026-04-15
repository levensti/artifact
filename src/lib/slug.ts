/**
 * Lossy URL-friendly slug from arbitrary text.
 *
 * Accepts a human title and produces a safe slug. Two distinct
 * titles CAN collide — that's acceptable for the wiki, where an
 * existing slug is treated as "update" rather than "new".
 */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
