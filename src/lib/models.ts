/**
 * The app uses a single fixed model served via OpenRouter (see
 * `src/lib/openrouter.ts`). This file holds only the minimal `Model` shape the
 * UI threads around; there is no longer a provider union or model picker.
 */

export interface Model {
  id: string;
  label: string;
  /** OpenRouter model id sent upstream. */
  modelId: string;
}
