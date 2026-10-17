"use client";

import { useEffect, useState } from "react";
import { getProjectsSnapshot } from "@/lib/client-data";
import { PROJECTS_UPDATED_EVENT } from "@/lib/storage-events";
import type { Project } from "@/lib/review-types";

/** The user's projects, kept current as they're created, renamed, or
 *  deleted anywhere in the app. */
export function useProjects(): Project[] {
  const [projects, setProjects] = useState<Project[]>(getProjectsSnapshot);
  useEffect(() => {
    const sync = () => setProjects(getProjectsSnapshot());
    sync();
    window.addEventListener(PROJECTS_UPDATED_EVENT, sync);
    return () => window.removeEventListener(PROJECTS_UPDATED_EVENT, sync);
  }, []);
  return projects;
}
