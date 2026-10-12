"use client";

import { Suspense } from "react";
import DashboardLayout from "@/components/dashboard-layout";
import DiscoverPanel from "@/components/discover-panel";

export default function DiscoverPage() {
  return (
    <DashboardLayout>
      {/* DiscoverPanel reads `?brief=` via useSearchParams. */}
      <Suspense fallback={null}>
        <DiscoverPanel />
      </Suspense>
    </DashboardLayout>
  );
}
