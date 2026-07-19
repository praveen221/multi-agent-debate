"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendFeedback, type FeedbackTrigger } from "@/lib/api";
import { markDismissed, markRated } from "@/lib/rating-governor";

// One-tap star rating with a conditional, always-skippable follow-up.
// Rendered as an inline card — the caller decides where it lives (below a
// generating report, at a round boundary in the transcript).
export function RatingPrompt({
  trigger,
  onClose,
}: {
  trigger: FeedbackTrigger;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  function dismiss() {
    if (!done) markDismissed();
    onClose();
  }

  async function submit(finalNote: string) {
    if (sending) return;
    setSending(true);
    try {
      await sendFeedback(finalNote.trim(), null, pathname, rating, trigger);
      markRated();
      setDone(true);
      setTimeout(onClose, 1600);
    } catch {
      // A failed rating isn't worth an error state — just close quietly.
      onClose();
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border bg-card px-5 py-4 text-center text-sm text-muted-foreground">
        Thank you — noted.
      </div>
    );
  }

  return (
    <div className="relative rounded-xl border bg-card px-5 py-4">
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="pr-8 text-sm">
        {trigger === "conclude"
          ? "While the report is written — how was this discussion?"
          : "Quick pulse check — how is Mad World doing?"}
      </p>

      <div className="mt-3 flex gap-1" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHovered(n)}
            className="p-0.5"
          >
            <Star
              className={`h-6 w-6 transition-colors ${
                n <= (hovered || rating)
                  ? "fill-foreground text-foreground"
                  : "text-muted-foreground/50"
              }`}
            />
          </button>
        ))}
      </div>

      {rating > 0 && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              rating >= 4 ? "What worked for you? (optional)" : "What went wrong? (optional)"
            }
            rows={2}
            maxLength={2000}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => submit("")} disabled={sending}>
              Skip
            </Button>
            <Button size="sm" onClick={() => submit(note)} disabled={sending}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
