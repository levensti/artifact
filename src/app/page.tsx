"use client";

import { BookOpen, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/dashboard-layout";
import { useState } from "react";
import NewStudyDialog from "@/components/new-study-dialog";
import { useRouter } from "next/navigation";

export default function Home() {
  const [showNewStudy, setShowNewStudy] = useState(false);
  const router = useRouter();

  return (
    <DashboardLayout>
      <div className="flex items-center justify-center h-full">
        <div className="max-w-sm text-center space-y-6">
          <div className="mx-auto size-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <BookOpen size={24} className="text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-lg font-semibold tracking-tight">
              Paper Copilot
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Create a study session to start reading a paper with your AI
              copilot. Select text, ask questions, get instant explanations.
            </p>
          </div>
          <Button onClick={() => setShowNewStudy(true)} className="gap-2">
            <Plus size={15} />
            New study
            <ArrowRight size={14} />
          </Button>
          <div className="flex items-center justify-center gap-4 text-muted-foreground/50 text-[11px]">
            <span>Bring your own keys</span>
            <span className="size-0.5 rounded-full bg-muted-foreground/30" />
            <span>Claude & GPT-4o</span>
            <span className="size-0.5 rounded-full bg-muted-foreground/30" />
            <span>Open source</span>
          </div>
        </div>
      </div>

      <NewStudyDialog
        open={showNewStudy}
        onClose={() => setShowNewStudy(false)}
        onCreated={(id) => {
          setShowNewStudy(false);
          router.push(`/study/${id}`);
        }}
      />
    </DashboardLayout>
  );
}
