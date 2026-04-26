/**
 * Tool: read_section
 *
 * Fetches a specific section from the structured paper representation
 * (when available). Lets the agent pull just the part of the paper
 * relevant to the user's question instead of carrying the full text in
 * every prompt.
 */

import type { ToolDefinition } from "./types";

export const readSectionTool: ToolDefinition = {
  name: "read_section",
  description:
    "Read a specific section of the paper. Use when the user asks about a " +
    "named section, when you need to verify a claim against the source, or " +
    "when the L1 summary doesn't have enough detail. Prefer this over scanning " +
    "the full paper. " +
    "Provide either `name` (case-insensitive heading match — e.g. " +
    '"Introduction", "3.2 Architecture") OR `index` (0-based position in the ' +
    "table of contents).",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Heading or partial heading of the section to read. " +
          'Examples: "Introduction", "Methods", "3.2".',
      },
      index: {
        type: "number",
        description:
          "0-based index of the section in the table of contents. " +
          "Use this when you know the position from a prior tool result.",
      },
    },
  },

  async execute(input, context) {
    const parsed = context.parsedPaper;
    if (!parsed) {
      return (
        "Error: this paper hasn't been parsed into sections yet. " +
        "The agent has the paper as flat text instead — use the existing " +
        "context rather than this tool."
      );
    }

    if (parsed.sections.length === 0) {
      return "Error: parsed paper has no sections.";
    }

    const idx = typeof input.index === "number" ? input.index : null;
    if (idx !== null) {
      if (idx < 0 || idx >= parsed.sections.length) {
        return `Error: index ${idx} is out of range (0..${parsed.sections.length - 1}).`;
      }
      return formatSection(idx, parsed.sections[idx]);
    }

    const nameRaw = String(input.name ?? "").trim();
    if (!nameRaw) {
      const toc = parsed.sections
        .map((s, i) => `[${i}] ${"  ".repeat(Math.max(0, s.level - 1))}${s.heading}`)
        .join("\n");
      return (
        "Error: provide either `name` or `index`. Available sections:\n\n" +
        toc
      );
    }

    const needle = nameRaw.toLowerCase();
    // Prefer exact heading match; fall back to substring match.
    let match = parsed.sections.findIndex(
      (s) => s.heading.toLowerCase() === needle,
    );
    if (match === -1) {
      match = parsed.sections.findIndex((s) =>
        s.heading.toLowerCase().includes(needle),
      );
    }

    if (match === -1) {
      const toc = parsed.sections
        .slice(0, 30)
        .map((s, i) => `[${i}] ${s.heading}`)
        .join("\n");
      return `No section heading matches "${nameRaw}". Available:\n\n${toc}`;
    }

    return formatSection(match, parsed.sections[match]);
  },
};

function formatSection(
  index: number,
  s: { heading: string; level: number; body: string; startPage?: number },
): string {
  const pageNote = s.startPage ? ` (p. ${s.startPage})` : "";
  return `Section [${index}] — ${s.heading}${pageNote}\n\n${s.body}`;
}
