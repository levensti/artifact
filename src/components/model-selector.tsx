"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { MODELS, PROVIDER_META, type Model } from "@/lib/models";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  selected: Model;
  onSelect: (model: Model) => void;
}

export default function ModelSelector({ selected, onSelect }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-medium bg-bg-secondary border border-border hover:border-border-light text-text-muted hover:text-text-secondary transition-all"
      >
        {selected.label}
        <ChevronDown size={10} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-border-light bg-bg-elevated shadow-[var(--shadow-lg)] z-50 py-1 overflow-hidden">
          {MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                onSelect(model);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-bg-hover transition-colors",
                selected.id === model.id
                  ? "text-accent"
                  : "text-text-secondary",
              )}
            >
              <div className="flex flex-col items-start">
                <span className="font-medium">{model.label}</span>
                <span className="text-[10px] text-text-muted">
                  {PROVIDER_META[model.provider].label}
                </span>
              </div>
              {selected.id === model.id && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
