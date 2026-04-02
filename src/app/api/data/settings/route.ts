import { getSettings, patchSettings } from "@/lib/server/store";
import type { InferenceProviderProfile, Model } from "@/lib/models";
import type { Provider } from "@/lib/models";

export const runtime = "nodejs";

export function GET() {
  return Response.json(getSettings());
}

export async function PATCH(req: Request) {
  let body: {
    keys?: Partial<Record<Provider, string | null>>;
    inferenceProfiles?: InferenceProviderProfile[] | null;
    selectedModel?: Model | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  patchSettings(body);
  return Response.json(getSettings());
}
