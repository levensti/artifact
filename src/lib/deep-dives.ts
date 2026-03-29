import {
  getDeepDivesSnapshot,
  saveDeepDive as saveDeepDiveRemote,
} from "@/lib/client-data";

export { DEEP_DIVES_UPDATED_EVENT } from "@/lib/storage-events";

export interface DeepDiveSession {
  id: string;
  reviewId: string;
  paperTitle: string;
  arxivId: string;
  topic: string;
  explanation: string;
  createdAt: string;
}

export function getDeepDives(): DeepDiveSession[] {
  return getDeepDivesSnapshot();
}

export async function saveDeepDive(
  payload: Omit<DeepDiveSession, "id" | "createdAt">,
): Promise<DeepDiveSession> {
  return saveDeepDiveRemote(payload);
}
