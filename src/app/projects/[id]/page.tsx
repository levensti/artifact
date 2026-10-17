"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import DashboardLayout from "@/components/dashboard-layout";
import ProjectPanel from "@/components/project-panel";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <DashboardLayout>
      {/* ProjectPanel reads `?brief=` via useSearchParams. */}
      <Suspense fallback={null}>
        <ProjectPanel key={id} projectId={id} />
      </Suspense>
    </DashboardLayout>
  );
}
