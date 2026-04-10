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
        <div className="max-w-lg text-center space-y-6">
          <div className="mx-auto size-20 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/8 to-primary/3 shadow-lg shadow-primary/10 flex items-center justify-center icon-glow">
            <BookOpen size={34} className="text-primary drop-shadow-sm" strokeWidth={1.5} />
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Artifact
            </h1>
            <p className="text-base text-muted-foreground/80 leading-relaxed max-w-sm mx-auto">
              Read arXiv papers with full-text context, annotate, and chat with
              an AI assistant.
            </p>
          </div>
          <Button
            onClick={() => setShowNewReview(true)}
            className="gap-2.5 h-11 px-7 rounded-xl shadow-md shadow-primary/15 text-sm font-semibold tracking-wide"
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
