"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getSession, nextTurnStream, endSession, ApiError, type AgentDraft, type Turn } from "@/lib/api";
import { agentAvatarClass } from "@/lib/agent-colors";
import { shortModelName } from "@/lib/models";
import { TurnMarkdown } from "@/components/turn-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function DebateSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [loadingSession, setLoadingSession] = useState(true);
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState("active");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [searchTrace, setSearchTrace] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetExceeded, setBudgetExceeded] = useState(false);
  const [agents, setAgents] = useState<AgentDraft[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topicRef = useRef<HTMLHeadingElement>(null);
  const [topicOverflowing, setTopicOverflowing] = useState(false);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    autoStartedRef.current = false;
    setLoadingSession(true);
    setError(null);
    getSession(sessionId)
      .then(({ session, turns }) => {
        setTopic(session.topic);
        setStatus(session.status);
        setTurns(turns);
        setAgents(session.agents);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingSession(false));
  }, [sessionId]);

  useEffect(() => {
    if (!loadingSession && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [loadingSession, sessionId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length, loading]);

  useEffect(() => {
    function measure() {
      const el = topicRef.current;
      setTopicOverflowing(!!el && el.scrollHeight > el.clientHeight + 1);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [topic]);

  function avatarForSpeaker(speaker: string): string {
    const index = agents.findIndex((a) => a.name === speaker);
    return agentAvatarClass(index === -1 ? 0 : index);
  }

  function initialsForSpeaker(speaker: string): string {
    const words = speaker.trim().split(/\s+/).filter(Boolean);
    return words
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("");
  }

  function agentConfigFor(speaker: string): AgentDraft | undefined {
    return agents.find((a) => a.name === speaker);
  }

  function costSoFarFor(speaker: string): number {
    return turns.filter((t) => t.speaker === speaker).reduce((sum, t) => sum + (t.cost_usd || 0), 0);
  }

  function avatarTitleFor(speaker: string): string {
    const config = agentConfigFor(speaker);
    if (!config) return speaker;
    return [
      speaker,
      config.model,
      `Web search: ${config.use_search ? "on" : "off"}`,
      `Cost so far: $${costSoFarFor(speaker).toFixed(4)}`,
    ].join("\n");
  }

  const debateCost = turns.reduce((sum, t) => sum + (t.cost_usd || 0), 0);

  async function handleNextTurn() {
    setError(null);
    setLoading(true);
    setSearchTrace([]);
    try {
      await nextTurnStream(sessionId, (event) => {
        if (event.type === "search") {
          setSearchTrace((prev) => [...prev, event.query]);
        } else if (event.type === "turn") {
          setTurns((prev) => [
            ...prev,
            {
              turn_index: event.turn_index,
              speaker: event.speaker,
              text: event.text,
              cost_usd: event.cost_usd,
            },
          ]);
          setSearchTrace([]);
        }
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setBudgetExceeded(true);
      }
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!loadingSession && status === "active" && turns.length === 0 && !autoStartedRef.current) {
      autoStartedRef.current = true;
      handleNextTurn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSession, status, turns.length]);

  async function handleEnd() {
    await endSession(sessionId).catch(() => {});
    setStatus("ended");
  }

  if (loadingSession) {
    return (
      <main className="flex h-full items-center justify-center text-muted-foreground">
        Loading debate…
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col">
      <div className="shrink-0 border-b px-6 py-6">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Topic
            </p>
            {topicOverflowing ? (
              <Popover>
                <PopoverTrigger
                  nativeButton={false}
                  render={
                    <h1
                      ref={topicRef}
                      title={topic}
                      className="mt-1 line-clamp-2 max-w-2xl cursor-pointer text-xl leading-snug hover:opacity-80"
                    >
                      {topic}
                    </h1>
                  }
                />
                <PopoverContent className="w-96 max-w-[90vw]" align="start">
                  <p className="text-sm leading-relaxed text-popover-foreground">{topic}</p>
                </PopoverContent>
              </Popover>
            ) : (
              <h1 ref={topicRef} className="mt-1 line-clamp-2 max-w-2xl text-xl leading-snug">
                {topic}
              </h1>
            )}
          </div>
          <p className="whitespace-nowrap text-xs text-muted-foreground">
            this debate: ${debateCost.toFixed(4)}
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {turns.map((turn) => (
          <div key={turn.turn_index} className="flex w-full gap-3">
            <div
              title={avatarTitleFor(turn.speaker)}
              className={`flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full text-xs font-medium ${avatarForSpeaker(turn.speaker)}`}
            >
              {initialsForSpeaker(turn.speaker)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-sm">
                <span className="font-medium">{turn.speaker}</span>
                {agentConfigFor(turn.speaker) && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {shortModelName(agentConfigFor(turn.speaker)!.model)}
                  </span>
                )}
              </p>
              <TurnMarkdown text={turn.text} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex w-full gap-3">
            <div
              title={avatarTitleFor(agents[turns.length % (agents.length || 1)]?.name || "")}
              className={`flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full text-xs font-medium ${avatarForSpeaker(agents[turns.length % (agents.length || 1)]?.name || "")}`}
            >
              {initialsForSpeaker(agents[turns.length % (agents.length || 1)]?.name || "?")}
            </div>
            <div className="min-w-0 flex-1 space-y-2 pt-1 text-sm text-muted-foreground">
              {searchTrace.length === 0 ? (
                <p className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                  Thinking…
                </p>
              ) : (
                searchTrace.map((q, i) => (
                  <p key={i} className="flex items-center gap-2">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                    searching: &ldquo;{q}&rdquo;
                  </p>
                ))
              )}
            </div>
          </div>
        )}
      </div>
      </div>

      <div className="shrink-0 border-t px-6 py-4">
        <div className="mx-auto max-w-3xl">
          {budgetExceeded ? (
            <Card className="mb-4 border-destructive/50">
              <CardContent className="pt-6 text-sm">
                <p className="font-medium text-destructive">Debate credit used up</p>
                <p className="mt-1 text-muted-foreground">
                  {error} Email{" "}
                  <a className="underline" href="mailto:mpj1391996@gmail.com">
                    mpj1391996@gmail.com
                  </a>{" "}
                  for more credits.
                </p>
              </CardContent>
            </Card>
          ) : (
            error && <p className="mb-4 text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-3">
            {status === "active" ? (
              <>
                <Button onClick={handleNextTurn} disabled={loading || budgetExceeded}>
                  {loading ? "Thinking…" : "Next turn"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="outline" disabled={loading}>
                        End debate
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>End this debate?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You won&apos;t be able to add more turns after this. The transcript stays
                        saved and you can still view it from the sidebar.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleEnd}>End debate</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">This debate has ended.</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
