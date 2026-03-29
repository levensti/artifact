"use client";

import { BookOpen, ArrowRight } from "lucide-react";
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
      <div className="flex items-center justify-center h-full px-6 bg-background">
        <div className="max-w-md text-center space-y-8">
          <div className="mx-auto size-16 rounded-xl border border-border bg-card flex items-center justify-center">
            <BookOpen size={28} className="text-primary" strokeWidth={1.5} />
          </div>
          <div className="space-y-3">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Artifact
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-104 mx-auto">
              Read arXiv papers with full-text context, annotate, and chat with
              an AI assistant.
            </p>
          </div>
          <Button
            onClick={() => setShowNewReview(true)}
            className="gap-2 h-10 px-5 rounded-lg"
          >
            Start a review
            <ArrowRight size={15} strokeWidth={2} />
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
