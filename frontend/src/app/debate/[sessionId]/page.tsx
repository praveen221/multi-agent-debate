"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Scale, Share2 } from "lucide-react";
import {
  getSession,
  nextTurnStream,
  endSession,
  addSteerMessage,
  runJudge,
  updateSessionJudge,
  shareSession,
  unshareSession,
  ApiError,
  type AgentDraft,
  type JudgeConfig,
  type Turn,
} from "@/lib/api";
import { ReportCard } from "@/components/report-card";
import { RatingPrompt } from "@/components/rating-prompt";
import { markPrompted, shouldAutoPrompt } from "@/lib/rating-governor";
import { agentAvatarClass } from "@/lib/agent-colors";
import { shortModelName } from "@/lib/models";
import { TurnMarkdown } from "@/components/turn-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
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

function agentTurnCount(list: Turn[]): number {
  return list.filter((t) => (t.role || "agent") === "agent").length;
}

// How many agent turns had happened as of the judge's most recent remark —
// the baseline for "a full round has passed, time for the next verdict".
function agentTurnsAtLastJudge(list: Turn[]): number {
  let count = 0;
  let last = 0;
  for (const t of list) {
    const role = t.role || "agent";
    if (role === "agent") count++;
    else if (role === "judge") last = count;
  }
  return last;
}

const DEFAULT_JUDGE_MODEL = "moonshotai/kimi-k2.5";

const DIRECTION_LABELS: Record<string, string> = {
  converging: "Converging",
  diverging: "Diverging",
  off_topic: "Drifting off-topic",
  stalling: "Stalling",
  balanced: "Balanced",
};

const JUDGE_ACTIONS = [
  { action: "intervene", label: "Intervene with this" },
  { action: "pressure_test", label: "Pressure-test" },
  { action: "refocus", label: "Refocus" },
] as const;

export default function DebateSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [loadingSession, setLoadingSession] = useState(true);
  const [topic, setTopic] = useState("");
  const [subject, setSubject] = useState("");
  const [templateLabel, setTemplateLabel] = useState<string | null>(null);
  const [status, setStatus] = useState("active");
  const [turns, setTurns] = useState<Turn[]>([]);
  type SearchEntry = { query: string; done: boolean; titles: string[]; resultCount: number };
  const [searchTrace, setSearchTrace] = useState<SearchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetExceeded, setBudgetExceeded] = useState(false);
  const [agents, setAgents] = useState<AgentDraft[]>([]);
  const [autoplayTarget, setAutoplayTarget] = useState(0);
  const [autoplayCycleStart, setAutoplayCycleStart] = useState(0);
  const [steerOpen, setSteerOpen] = useState(false);
  const [steerInput, setSteerInput] = useState("");
  const [pendingSteerText, setPendingSteerText] = useState<string | null>(null);
  const [judge, setJudge] = useState<JudgeConfig | null>(null);
  const [judging, setJudging] = useState<
    "verdict" | "intervene" | "pressure_test" | "refocus" | "report" | null
  >(null);
  const [lastJudgedAt, setLastJudgedAt] = useState(0);
  const [patchingJudge, setPatchingJudge] = useState(false);
  const [shareId, setShareId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [ratingPrompt, setRatingPrompt] = useState<"conclude" | "rounds" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const topicRef = useRef<HTMLHeadingElement>(null);
  const [topicOverflowing, setTopicOverflowing] = useState(false);
  const flushingSteerRef = useRef(false);

  useEffect(() => {
    setLoadingSession(true);
    setError(null);
    getSession(sessionId)
      .then(({ session, turns }) => {
        setTopic(session.topic);
        // Old sessions predate this column — fall back to the full topic.
        setSubject(session.subject || session.topic);
        setTemplateLabel(session.template_label || null);
        setStatus(session.status);
        setTurns(turns);
        setAgents(session.agents);
        setJudge(session.judge || null);
        setShareId(session.share_id || null);
        setLastJudgedAt(agentTurnsAtLastJudge(turns));
        const startCount = turns.length === 0 ? 0 : agentTurnCount(turns);
        setAutoplayCycleStart(startCount);
        setAutoplayTarget(turns.length === 0 ? 2 * session.agents.length : startCount);
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
  }, [turns.length, loading, judging, ratingPrompt]);

  useEffect(() => {
    function measure() {
      const el = topicRef.current;
      setTopicOverflowing(!!el && el.scrollHeight > el.clientHeight + 1);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [subject]);

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
      ...(config.stance
        ? [`Assigned stance: ${config.stance}`]
        : config.mode === "advise"
          ? ["Independent advisor — asked to critique candidly"]
          : []),
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
      await nextTurnStream(sessionId, turns.length, (event) => {
        if (event.type === "search") {
          setSearchTrace((prev) => [
            ...prev,
            { query: event.query, done: false, titles: [], resultCount: 0 },
          ]);
        } else if (event.type === "search_result") {
          setSearchTrace((prev) => {
            // First still-pending entry with this query — searches can
            // legitimately repeat within a turn, so match, don't index.
            const i = prev.findIndex((s) => s.query === event.query && !s.done);
            if (i === -1) return prev;
            const next = [...prev];
            next[i] = {
              ...next[i],
              done: true,
              titles: event.titles,
              resultCount: event.result_count,
            };
            return next;
          });
        } else if (event.type === "turn") {
          setTurns((prev) => [
            ...prev,
            {
              turn_index: event.turn_index,
              role: event.role || "agent",
              speaker: event.speaker,
              text: event.text,
              cost_usd: event.cost_usd,
              sources: event.sources,
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
      // A broken stream can leave this page behind the database — the turn
      // may have been saved before the stream died. Resync from the DB and
      // halt autoplay, so a stale count can never pick the wrong speaker
      // and the error stays visible instead of being wiped by a retry.
      try {
        const { session, turns: freshTurns } = await getSession(sessionId);
        setStatus(session.status);
        setJudge(session.judge || null);
        setTurns(freshTurns);
        setLastJudgedAt(agentTurnsAtLastJudge(freshTurns));
        setAutoplayTarget(agentTurnCount(freshTurns));
      } catch {
        setAutoplayTarget(agentTurnCount(turns));
      }
    } finally {
      setLoading(false);
      setSearchTrace([]);
    }
  }

  // Single mechanism drives every kind of auto-continuation: the initial
  // 2-round autoplay, the fresh round after a steer message, and even the
  // very first turn (turns.length === 0 < autoplayTarget already holds).
  // Nothing here ever interrupts an in-flight turn — it only ever decides
  // what happens next in the gap between turns.
  useEffect(() => {
    if (loadingSession || loading || judging !== null || status !== "active" || agents.length === 0)
      return;

    const count = agentTurnCount(turns);
    if (count < autoplayTarget) {
      handleNextTurn();
      return;
    }

    // The round is complete. A queued steer message lands first and skips
    // the verdict for this boundary — the user has already accounted for
    // the judge's read; the judge reviews the round that responds to them.
    if (pendingSteerText !== null) {
      if (flushingSteerRef.current) return;
      flushingSteerRef.current = true;
      const text = pendingSteerText;
      addSteerMessage(sessionId, text)
        .then((newTurn) => {
          setTurns((prev) => {
            const next: Turn[] = [
              ...prev,
              {
                turn_index: newTurn.turn_index,
                role: "human",
                speaker: newTurn.speaker,
                text: newTurn.text,
                cost_usd: 0,
              },
            ];
            const restartCount = agentTurnCount(next);
            setAutoplayCycleStart(restartCount);
            setAutoplayTarget(restartCount + agents.length);
            return next;
          });
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => {
          flushingSteerRef.current = false;
          setPendingSteerText(null);
        });
      return;
    }

    // A full round of agents has spoken since the judge's last remark —
    // time for a verdict. Waiting for autoplay to finish is what keeps
    // the judge silent between the initial rounds.
    if (judge?.enabled && count > 0 && count - lastJudgedAt >= agents.length) {
      setJudging("verdict");
      runJudge(sessionId, "verdict")
        .then((turn) => setTurns((prev) => [...prev, turn]))
        .catch((e) => setError((e as Error).message))
        .finally(() => {
          // Advance the baseline even on failure so a flaky judge model
          // can't put this effect into a retry loop.
          setLastJudgedAt(count);
          setJudging(null);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSession, loading, judging, status, turns, agents.length, autoplayTarget, pendingSteerText, judge, lastJudgedAt, sessionId]);

  // Deep-engagement pulse check: once a discussion passes 4 completed rounds
  // (2 automatic + 2 user-triggered), show an inline rating card at the next
  // idle round boundary. Same governor as the conclude prompt, so whichever
  // moment comes first is the only one that asks.
  useEffect(() => {
    if (loadingSession || loading || judging !== null || status !== "active") return;
    if (ratingPrompt !== null || agents.length === 0) return;
    const count = agentTurnCount(turns);
    if (
      count >= agents.length * 4 &&
      count % agents.length === 0 &&
      count >= autoplayTarget &&
      shouldAutoPrompt(sessionId)
    ) {
      markPrompted(sessionId);
      setRatingPrompt("rounds");
    }
  }, [loadingSession, loading, judging, status, turns, agents.length, autoplayTarget, ratingPrompt, sessionId]);

  async function handleEnd() {
    await endSession(sessionId).catch(() => {});
    setStatus("ended");
    // The report takes a few seconds — that wait is the ideal moment for a
    // one-tap rating (governed: max one auto-prompt per discussion).
    if (shouldAutoPrompt(sessionId)) {
      markPrompted(sessionId);
      setRatingPrompt("conclude");
    }
    generateReport();
  }

  async function generateReport() {
    if (judging !== null) return;
    setJudging("report");
    try {
      const turn = await runJudge(sessionId, "report");
      setTurns((prev) =>
        prev.some((t) => t.verdict?.kind === "report") ? prev : [...prev, turn],
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJudging(null);
    }
  }

  async function handleShare() {
    if (shareId || shareBusy) return;
    setShareBusy(true);
    try {
      const res = await shareSession(sessionId);
      setShareId(res.share_id);
      await navigator.clipboard
        .writeText(`${window.location.origin}/d/${res.share_id}`)
        .then(() => setShareCopied(true))
        .catch(() => {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setShareBusy(false);
    }
  }

  async function handleUnshare() {
    try {
      await unshareSession(sessionId);
      setShareId(null);
      setShareOpen(false);
      setShareCopied(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Everything is round-based: this plays one full round of all agents via
  // the same target-count mechanism as the initial autoplay, so the round
  // label, stop button, and end-of-round judge verdict all come for free.
  function startNextRound() {
    const count = agentTurnCount(turns);
    setAutoplayCycleStart(count);
    setAutoplayTarget(count + agents.length);
  }

  function stopAfterRound() {
    const count = agentTurnCount(turns);
    const intoRound = (count - autoplayCycleStart) % agents.length;
    // The in-flight (or partially played) round finishes; nothing beyond it.
    // If we're exactly at a round boundary with nothing in flight, stop now.
    const roundEnd =
      loading || intoRound !== 0
        ? autoplayCycleStart +
          (Math.floor((count - autoplayCycleStart) / agents.length) + 1) * agents.length
        : count;
    setAutoplayTarget((prev) => Math.min(prev, roundEnd));
  }

  function submitSteer() {
    const text = steerInput.trim();
    if (!text || pendingSteerText !== null) return;
    setPendingSteerText(text);
    setSteerInput("");
    setSteerOpen(false);
  }

  // The three buttons on a judge remark. The interjection enters the
  // transcript, then a fresh round auto-plays — same restart mechanics as
  // a human steer message.
  async function judgeAct(
    action: "intervene" | "pressure_test" | "refocus",
    sourceTurnIndex?: number,
  ) {
    if (loading || judging !== null || pendingSteerText !== null || status !== "active") return;
    setJudging(action);
    try {
      const turn = await runJudge(sessionId, action, sourceTurnIndex);
      setTurns((prev) => {
        const next = [...prev, turn];
        const count = agentTurnCount(next);
        setAutoplayCycleStart(count);
        setAutoplayTarget(count + agents.length);
        setLastJudgedAt(count);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setJudging(null);
    }
  }

  async function toggleJudge() {
    if (patchingJudge || status !== "active") return;
    const next: JudgeConfig = judge
      ? { ...judge, enabled: !judge.enabled }
      : { enabled: true, model: DEFAULT_JUDGE_MODEL };
    setPatchingJudge(true);
    try {
      const res = await updateSessionJudge(sessionId, next);
      setJudge(res.judge);
      if (res.judge.enabled) {
        // Let the judge read the room right away if a full round already
        // exists, instead of waiting for the next one.
        setLastJudgedAt(Math.max(0, agentTurnCount(turns) - agents.length));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPatchingJudge(false);
    }
  }

  const midAutoplay = agentTurnCount(turns) < autoplayTarget;
  // Action buttons only render on the newest judge remark — acting on an
  // older one would inject a stale read of the debate.
  const lastJudgeRemarkIndex = [...turns].reverse().find((t) => t.role === "judge")?.turn_index;
  const judgeActionsDisabled = loading || judging !== null || pendingSteerText !== null;
  const hasReport = turns.some((t) => t.verdict?.kind === "report");
  const shareUrl =
    shareId && typeof window !== "undefined" ? `${window.location.origin}/d/${shareId}` : "";
  const turnsPerRound = agents.length || 1;
  const turnsDoneThisCycle = Math.max(0, agentTurnCount(turns) - autoplayCycleStart);
  const roundNumber = Math.floor(turnsDoneThisCycle / turnsPerRound) + 1;
  const turnInRound = (turnsDoneThisCycle % turnsPerRound) + 1;

  if (loadingSession) {
    return (
      <main className="flex h-full items-center justify-center text-muted-foreground">
        Loading discussion…
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col">
      <div className="shrink-0 border-b px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Topic
              </p>
              {templateLabel && (
                <span className="rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {templateLabel}
                </span>
              )}
            </div>
            {/* subject is what the user typed; topic is the full composed
                instruction sent to agents — shown on expand for transparency. */}
            {topicOverflowing ? (
              <Popover>
                <PopoverTrigger
                  nativeButton={false}
                  render={
                    <h1
                      ref={topicRef}
                      title={subject}
                      className="mt-1 line-clamp-2 max-w-2xl cursor-pointer text-xl leading-snug hover:opacity-80"
                    >
                      {subject}
                    </h1>
                  }
                />
                <PopoverContent className="w-96 max-w-[90vw]" align="start">
                  {templateLabel && subject !== topic && (
                    <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      Sent to agents as
                    </p>
                  )}
                  <p className="text-sm leading-relaxed text-popover-foreground">{topic}</p>
                </PopoverContent>
              </Popover>
            ) : (
              <h1 ref={topicRef} className="mt-1 line-clamp-2 max-w-2xl text-xl leading-snug">
                {subject}
              </h1>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-col sm:items-end sm:gap-1.5">
            <div className="flex items-center gap-1.5">
              <Popover open={shareOpen} onOpenChange={setShareOpen}>
                <PopoverTrigger
                  render={
                    <button
                      onClick={handleShare}
                      title={
                        shareId
                          ? "This discussion has a public link"
                          : "Share this discussion publicly"
                      }
                      className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                        shareId ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Share2 className="h-3 w-3" />
                      {shareId ? "Shared" : "Share"}
                    </button>
                  }
                />
                <PopoverContent className="w-80" align="end">
                  {shareId ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Public link</p>
                      <p className="text-xs text-muted-foreground">
                        Anyone with this link can read this discussion.
                        {shareCopied ? " Copied to clipboard." : ""}
                      </p>
                      <Input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(shareUrl)
                              .then(() => setShareCopied(true))
                              .catch(() => {});
                          }}
                        >
                          {shareCopied ? "Copied" : "Copy"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleUnshare}>
                          Unshare
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {shareBusy ? "Creating link…" : "Couldn't create the link — try again."}
                    </p>
                  )}
                </PopoverContent>
              </Popover>
              {status === "active" && (
              <button
                onClick={toggleJudge}
                disabled={patchingJudge}
                title={
                  judge?.enabled
                    ? "The judge reviews each round — click to turn it off"
                    : "Bring in a judge to review each round"
                }
                aria-label={judge?.enabled ? "Turn judge off" : "Turn judge on"
                }
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                  judge?.enabled
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Scale className="h-3 w-3" />
                {judge?.enabled ? "Judge on" : "Judge off"}
              </button>
              )}
            </div>
            <p className="whitespace-nowrap font-mono text-xs text-muted-foreground">
              this discussion: ${debateCost.toFixed(4)}
            </p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-3xl space-y-6">
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
                {((turn.verdict?.agreements?.length ?? 0) > 0 ||
                  (turn.verdict?.contentions?.length ?? 0) > 0) && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Details
                    </summary>
                    <div className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
                      {(turn.verdict?.agreements?.length ?? 0) > 0 && (
                        <div>
                          <p className="font-medium">Agreed on</p>
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                            {turn.verdict!.agreements!.map((a, i) => (
                              <li key={i}>{a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(turn.verdict?.contentions?.length ?? 0) > 0 && (
                        <div>
                          <p className="font-medium">Still contested</p>
                          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                            {turn.verdict!.contentions!.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                )}
                {status === "active" && turn.turn_index === lastJudgeRemarkIndex && (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {turn.verdict?.suggested_action === "conclude" && (
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button size="sm" disabled={judgeActionsDisabled}>
                              Conclude &amp; generate report
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Conclude this discussion?</AlertDialogTitle>
                            <AlertDialogDescription>
                              The judge thinks this discussion has settled. No more rounds after
                              this — the judge will write the closing report, and the transcript
                              stays saved in your sidebar.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep discussing</AlertDialogCancel>
                            <AlertDialogAction onClick={handleEnd}>Conclude</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    {JUDGE_ACTIONS.map(({ action, label }) => (
                      <Button
                        key={action}
                        size="sm"
                        variant={turn.verdict?.suggested_action === action ? "default" : "outline"}
                        disabled={judgeActionsDisabled}
                        onClick={() =>
                          judgeAct(action, action === "intervene" ? turn.turn_index : undefined)
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : turn.role === "human" ? (
            <div key={turn.turn_index} className="flex w-full justify-end">
              <div className="max-w-[80%] rounded-2xl bg-secondary px-4 py-2">
                <p className="mb-0.5 text-xs font-medium text-muted-foreground">You</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{turn.text}</p>
              </div>
            </div>
          ) : (
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
                  {agentConfigFor(turn.speaker)?.stance ? (
                    <span
                      className="ml-1.5 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground"
                      title={agentConfigFor(turn.speaker)!.stance}
                    >
                      arguing a side
                    </span>
                  ) : agentConfigFor(turn.speaker)?.mode === "advise" ? (
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
                                <p className="mt-2 text-sm text-popover-foreground/90">
                                  {r.snippet}
                                </p>
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

        {loading && (
          <div className="flex w-full gap-3">
            <div
              title={avatarTitleFor(agents[agentTurnCount(turns) % (agents.length || 1)]?.name || "")}
              className={`flex h-8 w-8 shrink-0 cursor-default items-center justify-center rounded-full text-xs font-medium ${avatarForSpeaker(agents[agentTurnCount(turns) % (agents.length || 1)]?.name || "")}`}
            >
              {initialsForSpeaker(agents[agentTurnCount(turns) % (agents.length || 1)]?.name || "?")}
            </div>
            <div className="min-w-0 flex-1 space-y-2 pt-1 text-sm text-muted-foreground">
              {searchTrace.length === 0 ? (
                <p className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                  Thinking…
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
            </div>
          </div>
        )}

        {judging && (
          <div className="mx-auto w-full max-w-xl">
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Scale className="h-3.5 w-3.5 animate-pulse" />
              {judging === "verdict"
                ? "Judge is reviewing the round…"
                : judging === "report"
                  ? "Judge is writing the closing report…"
                  : "Judge is preparing an interjection…"}
            </p>
          </div>
        )}

        {ratingPrompt && (
          <div className="mx-auto w-full max-w-xl">
            <RatingPrompt trigger={ratingPrompt} onClose={() => setRatingPrompt(null)} />
          </div>
        )}
      </div>
      </div>

      <div className="shrink-0 border-t px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto max-w-3xl">
          {budgetExceeded ? (
            <Card className="mb-4 border-destructive/50">
              <CardContent className="pt-6 text-sm">
                <p className="font-medium text-destructive">Credits used up</p>
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

          {status === "active" && midAutoplay && (
            <p className="mb-2 font-mono text-xs text-muted-foreground">
              Round {roundNumber} · Turn {turnInRound} of {turnsPerRound}
            </p>
          )}

          {steerOpen && (
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={steerInput}
                  onChange={(e) => setSteerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitSteer();
                    } else if (e.key === "Escape") {
                      setSteerOpen(false);
                      setSteerInput("");
                    }
                  }}
                  placeholder="Say something to steer the discussion…"
                />
                <Button size="sm" onClick={submitSteer} disabled={!steerInput.trim()}>
                  Send
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSteerOpen(false);
                    setSteerInput("");
                  }}
                >
                  Cancel
                </Button>
              </div>
              {(loading || midAutoplay || judging !== null) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Will be added once this round finishes.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2 sm:gap-3">
            {status === "active" ? (
              <>
                {midAutoplay ? (
                  <Button variant="outline" onClick={stopAfterRound}>
                    Stop after this round
                  </Button>
                ) : (
                  <Button onClick={startNextRound} disabled={loading || judging !== null || budgetExceeded}>
                    Next round
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => setSteerOpen((v) => !v)}
                  disabled={pendingSteerText !== null}
                >
                  {pendingSteerText !== null ? "Message queued…" : "Interfere"}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="outline" disabled={loading || judging !== null}>
                        Conclude &amp; generate report
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Conclude this discussion?</AlertDialogTitle>
                      <AlertDialogDescription>
                        No more rounds after this. The judge will write a closing report of where
                        the discussion landed, and the transcript stays saved in your sidebar.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleEnd}>Conclude</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">This discussion has concluded.</p>
                {!hasReport && judging === null && (
                  <Button variant="outline" onClick={generateReport}>
                    Generate closing report
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
