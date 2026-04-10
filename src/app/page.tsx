"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BookOpen, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/dashboard-layout";
import NewReviewDialog from "@/components/new-review-dialog";
import DashboardFeed from "@/components/dashboard-feed";
import { useRouter } from "next/navigation";
import { hydrateClientStore } from "@/lib/client-data";
import { getReviews, REVIEWS_UPDATED_EVENT } from "@/lib/reviews";

function subscribeReviews(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(REVIEWS_UPDATED_EVENT, cb);
  return () => window.removeEventListener(REVIEWS_UPDATED_EVENT, cb);
}

export default function Home() {
  const [showNewReview, setShowNewReview] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    void hydrateClientStore().then(() => setReady(true));
  }, []);

  const reviewCount = useSyncExternalStore(
    subscribeReviews,
    () => getReviews().length,
    () => 0,
  );

  const hasReviews = ready && reviewCount > 0;

  return (
    <DashboardLayout>
      {hasReviews ? (
        <div className="h-full overflow-y-auto">
          <DashboardFeed onStartReview={() => setShowNewReview(true)} />
        </div>
      ) : (
        <div className="flex items-center justify-center h-full px-6 bg-background">
          <div className="max-w-md text-center space-y-8">
            <div className="mx-auto size-16 rounded-xl border border-border bg-card flex items-center justify-center" style={{ boxShadow: "var(--shadow-panel)" }}>
              <BookOpen size={28} className="text-primary" strokeWidth={1.5} />
            </div>
            <div className="space-y-3">
              <h1 className="text-xl font-semibold tracking-tight text-foreground">
                Artifact
              </h1>
              <p className="text-sm text-muted-foreground leading-relaxed max-w-104 mx-auto">
                Read arXiv papers with full-text context, annotate, and chat with
                an AI assistant. Track what you learn as you explore the frontier.
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
      )}

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
