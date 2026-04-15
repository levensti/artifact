"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/dashboard-layout";
import { useState } from "react";
import NewReviewDialog from "@/components/new-review-dialog";
import { useRouter } from "next/navigation";

export default function Home() {
  const [showNewReview, setShowNewReview] = useState(false);
  const router = useRouter();

  return (
    <DashboardLayout>
      <div className="flex h-full items-center justify-center bg-background px-6">
        <div className="max-w-lg space-y-10 text-center">
          <div className="space-y-5">
            <h1 className="text-[44px] font-bold leading-[1.05] tracking-[-0.03em] text-foreground">
              Artifact
            </h1>
            <p className="mx-auto max-w-md text-[17px] leading-relaxed text-muted-foreground">
              Discover the frontier.
            </p>
          </div>
          <Button
            onClick={() => setShowNewReview(true)}
            className="h-10 gap-2 rounded-md px-5 text-[13px] font-medium"
          >
            Get started
            <ArrowRight size={14} strokeWidth={2} />
          </Button>
        </div>
      </div>

      <NewReviewDialog
        open={showNewReview}
        onClose={() => setShowNewReview(false)}
        onCreated={(id) => {
          setShowNewReview(false);
          router.push(`/review/${id}`);
        }}
      />
    </DashboardLayout>
  );
}
