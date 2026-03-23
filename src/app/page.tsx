"use client";

import { BookOpen, Plus, ArrowRight } from "lucide-react";
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
          <div className="mx-auto w-16 h-16 rounded-2xl bg-accent-muted flex items-center justify-center">
            <BookOpen size={28} className="text-accent" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">
              Paper Copilot
            </h1>
            <p className="text-sm text-text-secondary leading-relaxed">
              Create a study session to start reading a paper with your AI
              copilot. Select text, ask questions, get instant explanations.
            </p>
          </div>
          <button
            onClick={() => setShowNewStudy(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          >
            <Plus size={15} />
            New study
            <ArrowRight size={14} />
          </button>
          <div className="flex items-center justify-center gap-4 text-text-muted text-xs pt-2">
            <span>Bring your own keys</span>
            <span className="w-px h-3 bg-border" />
            <span>Claude & GPT-4o</span>
            <span className="w-px h-3 bg-border" />
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
