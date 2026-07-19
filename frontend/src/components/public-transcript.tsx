"use client";

import { Scale } from "lucide-react";
import { agentAvatarClass } from "@/lib/agent-colors";
import { shortModelName } from "@/lib/models";
import { TurnMarkdown } from "@/components/turn-markdown";
import { ReportCard } from "@/components/report-card";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { PublicAgent, Turn } from "@/lib/api";

const DIRECTION_LABELS: Record<string, string> = {
  converging: "Converging",
  diverging: "Diverging",
  off_topic: "Drifting off-topic",
  stalling: "Stalling",
  balanced: "Balanced",
};

// Read-only rendering of a shared debate: same visual grammar as the owner's
// session view — agent bubbles, moderator messages, judge cards — minus every
// control, cost, and action button.
export function PublicTranscript({ agents, turns }: { agents: PublicAgent[]; turns: Turn[] }) {
  function avatarForSpeaker(speaker: string): string {
    const index = agents.findIndex((a) => a.name === speaker);
    return agentAvatarClass(index === -1 ? 0 : index);
  }

  function initialsForSpeaker(speaker: string): string {
    return speaker
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
  }

  function agentFor(speaker: string): PublicAgent | undefined {
    return agents.find((a) => a.name === speaker);
  }

  return (
    <div className="space-y-6">
      {turns.map((turn) =>
        turn.role === "judge" && turn.verdict?.kind === "report" ? (
          <ReportCard key={turn.turn_index} turn={turn} />
        ) : turn.role === "judge" && turn.verdict?.kind === "intervention" ? (
          <div key={turn.turn_index} className="mx-auto w-full max-w-xl">
            <div className="rounded-xl border px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Scale className="h-3.5 w-3.5" /> Judge interjects
              </p>
              <div className="mt-1.5">
                <TurnMarkdown text={turn.text} />
              </div>
            </div>
          </div>
        ) : turn.role === "judge" ? (
          <div key={turn.turn_index} className="mx-auto w-full max-w-xl">
            <div className="rounded-xl border bg-muted/40 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Scale className="h-3.5 w-3.5" /> Judge
                {turn.verdict?.direction && DIRECTION_LABELS[turn.verdict.direction] && (
                  <span className="ml-1 rounded-full border px-2 py-0.5">
                    {DIRECTION_LABELS[turn.verdict.direction]}
                  </span>
                )}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed">{turn.text}</p>
            </div>
          </div>
        ) : turn.role === "human" ? (
          <div key={turn.turn_index} className="flex w-full justify-end">
            <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2">
              <p className="mb-0.5 text-xs font-medium text-muted-foreground">Moderator</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.text}</p>
            </div>
          </div>
        ) : (
          <div key={turn.turn_index} className="flex w-full gap-3">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ${avatarForSpeaker(turn.speaker)}`}
            >
              {initialsForSpeaker(turn.speaker)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-sm">
                <span className="font-medium">{turn.speaker}</span>
                {agentFor(turn.speaker) && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {shortModelName(agentFor(turn.speaker)!.model)}
                  </span>
                )}
                {agentFor(turn.speaker)?.stance ? (
                  <span
                    className="ml-1.5 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground"
                    title={agentFor(turn.speaker)!.stance!}
                  >
                    arguing a side
                  </span>
                ) : agentFor(turn.speaker)?.mode === "advise" ? (
                  <span className="ml-1.5 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground">
                    advisor
                  </span>
                ) : null}
              </p>
              <TurnMarkdown text={turn.text} />
              {turn.sources && turn.sources.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                    Sources ({turn.sources.reduce((n, s) => n + s.results.length, 0)})
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {turn.sources.flatMap((s) =>
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
                            {r.snippet && (
                              <p className="mt-2 text-sm text-popover-foreground/90">{r.snippet}</p>
                            )}
                          </HoverCardContent>
                        </HoverCard>
                      )),
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
