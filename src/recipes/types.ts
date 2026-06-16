/**
 * A Recipe is the code-side definition of a system-under-test: a named,
 * versioned bundle of the prompts an agent runs with. It is the source of
 * truth that the `Recipe` row in the database (see prisma/schema.prisma)
 * points at by `name` — an eval run records which recipe it exercised, so a
 * score is reproducible from (benchmark, recipe, datasetVersion).
 *
 * `prompts` is a name -> prompt-text map rather than a single string because
 * one agent can run several distinct prompts (e.g. a system prompt plus a
 * separate summarizer or judge prompt). Read a prompt by name with
 * `promptFromRecipe` so a typo or a removed key fails loudly instead of
 * silently sending an empty system prompt.
 */
export interface Recipe {
  /** Stable identifier; matches the unique `Recipe.name` column. */
  name: string;
  /** One line on what this recipe is and when to use it. */
  description: string;
  /** Prompt name -> prompt text. Keys are the agent's prompt slots. */
  prompts: Record<string, string>;
}

/**
 * Read one prompt out of a recipe by name, throwing if it is absent. Use this
 * everywhere instead of `recipe.prompts[name]` so a renamed or missing prompt
 * surfaces immediately rather than as a downstream empty-prompt bug.
 */
export function promptFromRecipe(recipe: Recipe, promptName: string): string {
  const prompt = recipe.prompts[promptName];
  if (prompt === undefined) {
    throw new Error(
      `Recipe "${recipe.name}" has no prompt named "${promptName}". ` +
        `Available: ${Object.keys(recipe.prompts).join(", ") || "(none)"}.`,
    );
  }
  return prompt;
}
