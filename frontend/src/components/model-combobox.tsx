"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/lib/api";

function formatPricePerMillion(perTokenPrice: string | undefined): string {
  const n = parseFloat(perTokenPrice || "0");
  if (!n || n < 0) return "free";
  return `$${(n * 1_000_000).toFixed(2)}/1M`;
}

export function ModelCombobox({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="w-full justify-between font-normal">
            <span className="truncate">{value || "Select a model…"}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No model found.</CommandEmpty>
            <CommandGroup>
              {models.map((m) => (
                <CommandItem
                  key={m.id}
                  value={m.id}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === m.id ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex-1 truncate">{m.id}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {formatPricePerMillion(m.pricing?.prompt)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
