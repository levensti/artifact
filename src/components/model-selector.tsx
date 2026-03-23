"use client";

import { ChevronDown, Check } from "lucide-react";
import { MODELS, PROVIDER_META, type Model } from "@/lib/models";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ModelSelectorProps {
  selected: Model;
  onSelect: (model: Model) => void;
}

export default function ModelSelector({ selected, onSelect }: ModelSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex items-center h-7 gap-1 px-2 text-xs text-muted-foreground font-normal rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
          {selected.label}
          <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {MODELS.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => onSelect(model)}
            className="flex items-center justify-between"
          >
            <div className="flex flex-col">
              <span className={cn("text-xs", selected.id === model.id && "text-primary font-medium")}>
                {model.label}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {PROVIDER_META[model.provider].label}
              </span>
            </div>
            {selected.id === model.id && <Check size={12} className="text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
