"use client";

import { BookOpen, Plus, ArrowRight } from "lucide-react";
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
      <div className="flex items-center justify-center h-full px-6 bg-gradient-to-b from-white via-[#fafafa] to-zinc-100/60">
        <div className="max-w-md text-center space-y-8">
          <div className="mx-auto size-16 rounded-2xl bg-white ring-1 ring-border shadow-sm flex items-center justify-center">
            <BookOpen size={28} className="text-primary" strokeWidth={1.5} />
          </div>
          <div className="space-y-3">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Paper Copilot
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-[28rem] mx-auto">
              Review arXiv papers with an AI that sees the full text. Your
              questions and answers stay with each paper so you can skim the
              thread later or before a meeting.
            </p>
          </div>
          <Button
            onClick={() => setShowNewReview(true)}
            className="gap-2 h-10 px-5 rounded-xl shadow-sm"
          >
            <Plus size={16} strokeWidth={2} />
            New paper review
            <ArrowRight size={15} strokeWidth={2} />
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-muted-foreground/70 text-xs">
            <span>Your API keys</span>
            <span className="size-0.5 rounded-full bg-muted-foreground/35" />
            <span>Claude & GPT-4o</span>
            <span className="size-0.5 rounded-full bg-muted-foreground/35" />
            <span>Local history</span>
          </div>
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
