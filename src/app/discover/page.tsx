import { Suspense } from "react";
import DashboardLayout from "@/components/dashboard-layout";
import DiscoverClient from "./discover-client";

function DiscoverFallback() {
  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto bg-background px-6 py-5 flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    </DashboardLayout>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<DiscoverFallback />}>
      <DiscoverClient />
    </Suspense>
  );
}
