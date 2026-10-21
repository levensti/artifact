/**
 * Tool: update_artifact
 *
 * Edit an existing artifact in place by appending a version: string edits
 * (old_str/new_str, each matching exactly once) for targeted changes, or a
 * full rewrite. The user sees one line in the chat with what changed, plus
 * Undo and "Keep as separate artifact", so the model can decide edit-vs-new
 * on its own and a wrong guess costs one click.
 */

import type { ToolDefinition } from "./types";
import {
  applyArtifactEdits,
  editsFromToolInput,
  formatArtifactRef,
  UPDATE_ARTIFACT_TOOL,
} from "@/lib/artifacts";
import { lintArtifactHtml } from "@/server/artifact-lint";

export const updateArtifactTool: ToolDefinition = {
  name: UPDATE_ARTIFACT_TOOL,
  description:
    "Edit an existing artifact in place, saving a new version (the user can undo it). Use it when the request changes an artifact that exists, especially the one open beside the chat: simplify or expand a part, add an example or a quiz, fix something, restyle it. Prefer `edits` (exact string replacements) for targeted changes; send `html` only to rewrite most of the page. Use create_artifact instead for a different topic or when the user wants to keep the original.",
  parameters: {
    type: "object",
    properties: {
      artifact_id: {
        type: "string",
        description: "The artifact's id, from its [artifact:<id> vN] ref.",
      },
      change: {
        type: "string",
        description:
          "One short line on what changed, shown to the user and in the version history, e.g. \"Simplified the method section\". No em dashes.",
      },
      edits: {
        type: "array",
        description:
          "Exact replacements applied in order. Each old_str must be copied from the current source and occur exactly once.",
        items: {
          type: "object",
          description: "One replacement.",
          properties: {
            old_str: { type: "string", description: "Text to replace." },
            new_str: {
              type: "string",
              description: "Its replacement (empty deletes it).",
            },
          },
          required: ["old_str", "new_str"],
        },
      },
      html: {
        type: "string",
        description: "The full new page source, replacing it entirely. Omit when using edits.",
      },
      title: {
        type: "string",
        description: "New title, only if it should change.",
      },
      summary: {
        type: "string",
        description: "New card summary, only if it should change.",
      },
    },
    required: ["artifact_id", "change"],
  },

  async execute(input, context, call) {
    if (!context.artifacts) {
      return { content: "Error: artifacts aren't available here.", ok: false };
    }
    const id = typeof input.artifact_id === "string" ? input.artifact_id.trim() : "";
    const change = typeof input.change === "string" ? input.change.trim() : "";
    if (!id || !change) {
      return { content: "Error: artifact_id and change are required.", ok: false };
    }
    const current = await context.artifacts.current(id);
    if (!current) {
      return { content: `Error: no artifact with id ${id} in this review.`, ok: false };
    }

    const edits = editsFromToolInput(input);
    const fullHtml = typeof input.html === "string" ? input.html.trim() : "";
    let html: string;
    if (fullHtml) {
      html = fullHtml;
    } else if (edits.length > 0) {
      const applied = applyArtifactEdits(current.html, edits);
      if (!applied.ok) {
        return { content: `Error: not saved. ${applied.error}`, ok: false };
      }
      html = applied.html;
    } else {
      return { content: "Error: send edits or html.", ok: false };
    }

    const lint = lintArtifactHtml(html);
    if (lint.errors.length > 0) {
      return {
        content: `Error: not saved. ${lint.errors.join(" ")} Fix these and call update_artifact again.`,
        ok: false,
      };
    }
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    const ref = await context.artifacts.append(id, {
      html: lint.html,
      changeSummary: change,
      sourceCallId: call?.id ?? crypto.randomUUID(),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
    });
    return `Updated artifact "${title || current.title}" to v${ref.version} ${formatArtifactRef(ref)}. The user sees what changed in the chat and can undo it. Reply with one sentence saying what you changed; don't repeat the content.`;
  },
};
