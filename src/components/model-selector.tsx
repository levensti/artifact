"use client";

import { Fragment } from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  modelsGroupedByProvider,
  PROVIDER_META,
  type Model,
} from "@/lib/models";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ModelSelectorProps {
  selected: Model | null;
  onSelect: (model: Model) => void;
}

const GROUPS = modelsGroupedByProvider();

export default function ModelSelector({ selected, onSelect }: ModelSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center h-7 gap-1 px-2 text-xs text-muted-foreground font-normal rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
        aria-label={selected ? `Model: ${selected.label}` : "Select model"}
      >
        {selected ? selected.label : "Select model"}
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {GROUPS.map(({ provider, models }, groupIndex) => (
          <Fragment key={provider}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-[11px] font-medium text-foreground">
                {PROVIDER_META[provider].label}
              </DropdownMenuLabel>
              <p className="px-1.5 pb-1.5 text-[10px] text-muted-foreground leading-snug">
                Uses your {PROVIDER_META[provider].keyHint}.
              </p>
              {models.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onClick={() => onSelect(model)}
                  className="flex items-center justify-between gap-2"
                >
                  <span
                    className={cn(
                      "text-xs",
                      selected?.id === model.id && "text-primary font-medium",
                    )}
                  >
                    {model.label}
                  </span>
                  {selected?.id === model.id && (
                    <Check size={12} className="text-primary shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
