/**
 * One-shot handoff for a research question asked on Home. Home stashes the
 * text and navigates to /artifacts, where the panel that owns the research
 * run picks it up and starts it. Module state (not the URL) so a refresh or
 * Back never re-submits the same question.
 */

let pending: string | null = null;

export function setPendingResearch(text: string): void {
  pending = text.trim() || null;
}

/** Returns the stashed question once, clearing it. */
export function takePendingResearch(): string | null {
  const text = pending;
  pending = null;
  return text;
}
