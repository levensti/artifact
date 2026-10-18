"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DashboardLayout from "@/components/dashboard-layout";
import {
  ensureDiscoverLoaded,
  getDiscoverQueriesSnapshot,
  hydrateClientStore,
} from "@/lib/client-data";

/**
 * Research briefs used to live here; they now live in projects. Old links
 * still land: `?brief=<id>` opens that brief in its project, anything else
 * goes to Projects.
 */
function ArtifactsRedirect() {
  const router = useRouter();
  const brief = useSearchParams().get("brief");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let href = "/projects";
      if (brief) {
        await Promise.all([hydrateClientStore(), ensureDiscoverLoaded()]).catch(
          () => {},
        );
        const projectId = getDiscoverQueriesSnapshot().find(
          (q) => q.id === brief,
        )?.projectId;
        if (projectId) {
          href = `/projects/${projectId}?brief=${encodeURIComponent(brief)}`;
        }
      }
      if (!cancelled) router.replace(href);
    })();
    return () => {
      cancelled = true;
    };
  }, [brief, router]);
  return null;
}

export default function ArtifactsPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={null}>
        <ArtifactsRedirect />
      </Suspense>
    </DashboardLayout>
  );
}
