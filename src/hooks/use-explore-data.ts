"use client";

import { useCallback, useEffect, useState } from "react";
import { loadExplore } from "@/lib/client-data";
import {
  EXPLORE_UPDATED_EVENT,
  type PrerequisitesData,
} from "@/lib/explore";

interface ExploreData {
  prerequisites: PrerequisitesData | null;
}

export function useExploreData(reviewId: string): ExploreData {
  const read = useCallback(async (): Promise<ExploreData> => {
    return loadExplore(reviewId);
  }, [reviewId]);

  const [data, setData] = useState<ExploreData>({
    prerequisites: null,
  });

  useEffect(() => {
    let cancelled = false;
    void read().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [read]);

  useEffect(() => {
    const handler = () => {
      void read().then(setData);
    };
    window.addEventListener(EXPLORE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(EXPLORE_UPDATED_EVENT, handler);
  }, [read]);

  return data;
}
