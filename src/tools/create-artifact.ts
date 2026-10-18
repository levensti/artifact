/**
 * Tool: create_artifact
 *
 * Structured output for interactive learning material (a skimmable overview
 * of the paper, a concept explainer, a comparison). The tool call's input IS
 * the artifact: the client renders it as a preview card in the chat that
 * opens it in the Artifacts tab, and the chat route saves it to
 * `ReviewArtifact` when the turn ends so it lists there. `execute` only
 * validates and acknowledges.
 *
 * The html uses the same GenUI vocabulary as the ```diagram fence plus a few
 * document elements (see ARTIFACT_GUIDE in the reading-agent recipe), and is
 * sanitized at render time.
 */

import type { ToolDefinition } from "./types";
import { artifactFromToolInput, CREATE_ARTIFACT_TOOL } from "@/lib/artifacts";

export const createArtifactTool: ToolDefinition = {
  name: CREATE_ARTIFACT_TOOL,
  description:
    "Create an interactive learning artifact the user opens in their Artifacts tab, beside the document, and can come back to later: a skimmable overview of the whole paper, a visual explainer of one concept, a comparison of methods, and the like. Use it when the user asks for an overview, artifact, explainer, or study material, not for ordinary answers. Follow the artifact reference in the system prompt for the HTML vocabulary.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short title, at most 8 words. No em dashes.",
      },
      summary: {
        type: "string",
        description:
          "One or two plain sentences saying what the artifact covers, shown on its preview card.",
      },
      html: {
        type: "string",
        description:
          "The artifact body: HTML in the artifact vocabulary (dx-* classes, details/summary sections, paper references like §3.2 or Fig. 4 written as plain text).",
      },
    },
    required: ["title", "summary", "html"],
  },

  async execute(input: Record<string, unknown>) {
    const artifact = artifactFromToolInput(input);
    if (!artifact) {
      return {
        content: "Error: title and html are required.",
        ok: false,
      };
    }
    return `Artifact "${artifact.title}" created. The user sees it as a card in the chat and in their Artifacts tab. Do not repeat its contents; reply with at most two sentences pointing them to it.`;
  },
};
