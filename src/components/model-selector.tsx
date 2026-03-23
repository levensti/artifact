"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { MODELS, type Model } from "@/lib/models";
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
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-bg-tertiary hover:bg-border-light text-text-secondary transition-colors"
      >
        {selected.label}
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-bg-secondary shadow-xl z-50 py-1 animate-in fade-in slide-in-from-top-1 duration-100">
          {MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => {
                onSelect(model);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-bg-tertiary transition-colors",
                selected.id === model.id
                  ? "text-accent"
                  : "text-text-secondary",
              )}
            >
              <span>
                {model.label}
                <span className="text-text-muted ml-1.5">
                  ({model.provider === "anthropic" ? "Anthropic" : "OpenAI"})
                </span>
              </span>
              {selected.id === model.id && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
