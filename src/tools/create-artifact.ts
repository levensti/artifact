/**
 * Tool: create_artifact
 *
 * Interactive learning material (a skimmable overview of the paper, a concept
 * explainer with a parameter to play with, a self-check quiz). The page is
 * HTML with inline style and script that the app runs in a sandboxed iframe
 * beside the paper, styled by the app's injected theme (see ARTIFACT_GUIDE in
 * the reading-agent recipe and artifact-frame.ts).
 *
 * Saves the artifact as version 1 when it runs, so a later update_artifact in
 * the same turn can find it. The result carries the artifact ref, which the
 * model uses to edit it and the chat card uses to open it.
 */

import type { ToolDefinition } from "./types";
import {
  artifactFromToolInput,
  CREATE_ARTIFACT_TOOL,
  formatArtifactRef,
} from "@/lib/artifacts";
import { lintArtifactHtml } from "@/server/artifact-lint";

export const createArtifactTool: ToolDefinition = {
  name: CREATE_ARTIFACT_TOOL,
  description:
    "Create a NEW interactive learning artifact the user opens in their Artifacts tab, beside the document, and can come back to later: a skimmable overview of the whole paper, an explainer of one concept, a comparison, a self-check. Use it when the user asks for an overview, artifact, explainer, or study material, not for ordinary answers. To change an artifact that already exists (including the one the user has open), use update_artifact instead. Follow the artifact reference in the system prompt.",
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
          "The page body: HTML with inline <style> and <script> as the artifact reference describes. No <html>/<head>/<body> wrapper.",
      },
    },
    required: ["title", "summary", "html"],
  },

  async execute(input, context, call) {
    const artifact = artifactFromToolInput(input);
    if (!artifact) {
      return { content: "Error: title and html are required.", ok: false };
    }
    if (!context.artifacts) {
      return { content: "Error: artifacts aren't available here.", ok: false };
    }
    const lint = lintArtifactHtml(artifact.html);
    if (lint.errors.length > 0) {
      return {
        content: `Error: not saved. ${lint.errors.join(" ")} Fix these and call create_artifact again.`,
        ok: false,
      };
    }
    const ref = await context.artifacts.create(
      { ...artifact, html: lint.html },
      call?.id ?? crypto.randomUUID(),
    );
    const fixes =
      lint.styleFixes > 0
        ? ` ${lint.styleFixes} raw colors or fonts were mapped to theme tokens; use var(--…) tokens next time.`
        : "";
    return `Created artifact "${artifact.title}" ${formatArtifactRef(ref)}. The user sees it as a card in the chat and in their Artifacts tab.${fixes} Do not repeat its contents; reply with at most two sentences pointing them to it.`;
  },
};
