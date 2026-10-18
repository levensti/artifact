/**
 * One-shot handoff for a research question asked on Home. Home creates a
 * project for it, stashes the text, and navigates to the project, whose page
 * picks it up and starts the run. Module state (not the URL) so a refresh or
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
