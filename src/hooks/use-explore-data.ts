"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EXPLORE_UPDATED_EVENT,
  getPrerequisites,
  getGraphData,
  type PrerequisitesData,
  type GraphData,
} from "@/lib/explore";

interface ExploreData {
  prerequisites: PrerequisitesData | null;
  graph: GraphData | null;
}

export function useExploreData(reviewId: string): ExploreData {
  const read = useCallback(
    (): ExploreData => ({
      prerequisites: getPrerequisites(reviewId),
      graph: getGraphData(reviewId),
    }),
    [reviewId],
  );

  const [data, setData] = useState<ExploreData>(read);

  // Re-read when reviewId changes
  useEffect(() => {
    setData(read());
  }, [read]);

  // Re-read when explore data is updated (custom event from localStorage saves)
  useEffect(() => {
    const handler = () => setData(read());
    window.addEventListener(EXPLORE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(EXPLORE_UPDATED_EVENT, handler);
  }, [read]);

  return data;
}
