"use client";

import { Scale } from "lucide-react";
import { TurnMarkdown } from "@/components/turn-markdown";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { shortModelName } from "@/lib/models";
import type { FollowupOption, SingleTurn, Source } from "@/lib/api";

export type SearchEntry = { query: string; done: boolean; titles: string[]; resultCount: number };

function SourceList({ sources }: { sources: Source[] }) {
  const count = sources.reduce((n, s) => n + s.results.length, 0);
  if (count === 0) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        Sources ({count})
      </summary>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sources.flatMap((s) =>
          s.results.map((r, i) => (
            <HoverCard key={`${s.query}-${i}`}>
              <HoverCardTrigger
                render={
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-[220px] truncate rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {r.title || r.url}
                  </a>
                }
              />
              <HoverCardContent className="w-80">
                <p className="font-medium">{r.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{r.url}</p>
                {r.snippet && <p className="mt-2 text-sm text-popover-foreground/90">{r.snippet}</p>}
              </HoverCardContent>
            </HoverCard>
          )),
        )}
      </div>
    </details>
  );
}

/** The single-model track: the model's answers, any fanned-in interventions,
 *  the live stream, and the generated follow-up options (the only way to
 *  advance it — no free-text prompt). */
export function SingleTrack({
  turns,
  model,
  streamingText,
  searchTrace,
  loading,
  options,
  onOption,
  status,
}: {
  turns: SingleTurn[];
  model: string | null;
  streamingText: string;
  searchTrace: SearchEntry[];
  loading: boolean;
  options: FollowupOption[];
  onOption: (option: FollowupOption) => void;
  status: string;
}) {
  return (
    <div className="space-y-6">
      {turns.map((t) => {
        if (t.role === "human") {
          return (
            <div key={t.turn_index} className="flex w-full justify-end">
              <div className="max-w-2xl rounded-2xl bg-secondary px-4 py-2">
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">You</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{t.text}</p>
              </div>
            </div>
          );
        }
        if (t.role === "judge") {
          return (
            <div
              key={t.turn_index}
              className="rounded-xl border border-[#c4b5fd]/30 bg-muted/40 px-4 py-3"
            >
              <p className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                <Scale className="h-3.5 w-3.5 text-[#c4b5fd]" /> Challenge
              </p>
              <div className="mt-2">
                <TurnMarkdown text={t.text} />
              </div>
            </div>
          );
        }
        return (
          <div key={t.turn_index} className="border-l-2 border-[#a0c3ec]/50 pl-4">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[15px] font-semibold text-foreground">Single model</span>
              {model && (
                <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  {shortModelName(model)}
                </span>
              )}
              {t.option_label && (
                <span className="rounded-full border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {t.option_label}
                </span>
              )}
            </div>
            <TurnMarkdown text={t.text} />
            {t.sources && t.sources.length > 0 && <SourceList sources={t.sources} />}
          </div>
        );
      })}

      {loading && (
        <div className="border-l-2 border-[#a0c3ec]/50 pl-4">
          <div className="mb-1.5 flex items-baseline gap-x-2">
            <span className="text-[15px] font-semibold text-foreground">Single model</span>
            {model && (
              <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                {shortModelName(model)}
              </span>
            )}
          </div>
          {streamingText ? (
            <div>
              <TurnMarkdown text={streamingText} />
              <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-pulse bg-foreground/60 align-text-bottom" />
            </div>
          ) : (
            <div className="space-y-2 pt-1 text-sm text-muted-foreground">
              {searchTrace.length === 0 ? (
                <p className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                  Thinking&hellip;
                </p>
              ) : (
                searchTrace.map((s, i) => (
                  <p key={i} className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full bg-current ${s.done ? "" : "animate-pulse"}`}
                    />
                    {!s.done ? (
                      <>searching: &ldquo;{s.query}&rdquo;</>
                    ) : s.titles.length > 0 ? (
                      <>
                        found: &ldquo;{s.titles[0]}&rdquo;
                        {s.resultCount > 1 ? ` +${s.resultCount - 1} more` : ""}
                      </>
                    ) : (
                      <>no results for &ldquo;{s.query}&rdquo;</>
                    )}
                  </p>
                ))
              )}
              {searchTrace.length > 0 && searchTrace.every((s) => s.done) && (
                <p className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                  Writing the answer&hellip;
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && status === "active" && options.length > 0 && (
        <div className="pt-1">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Take it further
          </p>
          <div className="flex flex-wrap gap-2">
            {options.map((o, i) => (
              <Button
                key={i}
                size="sm"
                variant="outline"
                className="text-muted-foreground"
                onClick={() => onOption(o)}
                title={o.instruction}
              >
                {o.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {turns.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">No single-model answer yet.</p>
      )}
    </div>
  );
}
