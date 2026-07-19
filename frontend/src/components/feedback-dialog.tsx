"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { sendFeedback, type FeedbackCategory } from "@/lib/api";

const CATEGORIES: { id: FeedbackCategory; label: string }[] = [
  { id: "bug", label: "Bug" },
  { id: "idea", label: "Idea" },
  { id: "other", label: "Other" },
];

export function FeedbackDialog({ trigger }: { trigger: React.ReactElement }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCategory(null);
    setMessage("");
    setSent(false);
    setError(null);
  }

  async function handleSubmit() {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback(message.trim(), category, pathname);
      setSent(true);
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 1400);
    } catch {
      setError("Couldn't send that — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Feedback</DialogTitle>
          <DialogDescription>
            Bugs, ideas, feature requests — we read every one.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Thank you — got it.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(category === c.id ? null : c.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    category === c.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What's on your mind?"
              rows={5}
              maxLength={4000}
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button onClick={handleSubmit} disabled={!message.trim() || sending}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
