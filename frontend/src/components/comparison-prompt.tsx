"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { submitComparison } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** The benchmark question — pops up once, at the conclude moment, when a single
 *  model was run alongside the debate. Binary, quick, and stored separately from
 *  general app feedback so we can eventually surface a debate-vs-single number. */
export function ComparisonPrompt({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [done, setDone] = useState(false);

  function choose(preference: "single" | "multi") {
    setDone(true);
    submitComparison(sessionId, preference).catch(() => {});
    setTimeout(onClose, 1400);
  }

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="relative w-full max-w-md rounded-xl border bg-card p-4 shadow-lg">
        <button
          onClick={onClose}
          aria-label="Dismiss"
          className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {done ? (
          <p className="text-sm text-foreground">Thanks — that helps us benchmark.</p>
        ) : (
          <>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Quick one
            </p>
            <p className="mb-3 pr-6 text-sm text-foreground">
              Which answer did you find more useful — the debate, or the single model?
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => choose("multi")}>
                The debate
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => choose("single")}
              >
                Single model
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
