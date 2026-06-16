/**
 * Recipe registry. Add a recipe here so it can be looked up by name (the same
 * name stored on the `Recipe` row an eval run references).
 */
import type { Recipe } from "./types";
import { researchAssistantRecipe } from "./research-assistant";
import { readingAgentRecipe } from "./reading-agent";

export type { Recipe } from "./types";
export { promptFromRecipe } from "./types";
export { researchAssistantRecipe } from "./research-assistant";
export {
  readingAgentRecipe,
  getReadingSystemPrompt,
  visualFormatReminder,
  READING_AGENT_PROMPTS,
} from "./reading-agent";

export const RECIPES: Record<string, Recipe> = {
  [researchAssistantRecipe.name]: researchAssistantRecipe,
  [readingAgentRecipe.name]: readingAgentRecipe,
};

/** Look up a recipe by name, throwing if it is not registered. */
export function recipeByName(name: string): Recipe {
  const recipe = RECIPES[name];
  if (!recipe) {
    throw new Error(
      `No recipe named "${name}". Registered: ${Object.keys(RECIPES).join(", ") || "(none)"}.`,
    );
  }
  return recipe;
}
