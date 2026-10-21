/**
 * Tool: read_artifact
 *
 * The current source of one of the review's artifacts, so the model can copy
 * exact old_str text for update_artifact. The artifact open beside the chat
 * is already in context each turn; this is for the others.
 */

import type { ToolDefinition } from "./types";
import { formatArtifactRef, READ_ARTIFACT_TOOL } from "@/lib/artifacts";

export const readArtifactTool: ToolDefinition = {
  name: READ_ARTIFACT_TOOL,
  description:
    "Read an artifact's current page source (title, summary, html) before editing it with update_artifact. Not needed for the artifact the user has open: its source is already in context.",
  parameters: {
    type: "object",
    properties: {
      artifact_id: {
        type: "string",
        description: "The artifact's id, from its [artifact:<id> vN] ref.",
      },
    },
    required: ["artifact_id"],
  },

  async execute(input, context) {
    if (!context.artifacts) {
      return { content: "Error: artifacts aren't available here.", ok: false };
    }
    const id = typeof input.artifact_id === "string" ? input.artifact_id.trim() : "";
    const current = id ? await context.artifacts.current(id) : null;
    if (!current) {
      return { content: `Error: no artifact with id ${id} in this review.`, ok: false };
    }
    return `Artifact "${current.title}" ${formatArtifactRef({ id, version: current.version })}\nSummary: ${current.summary}\n\n${current.html}`;
  },
};
