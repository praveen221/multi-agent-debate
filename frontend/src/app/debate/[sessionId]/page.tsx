"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSession, nextTurnStream, endSession, ApiError, type Turn } from "@/lib/api";
import { agentColorClass } from "@/lib/agent-colors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  const [agentOrder, setAgentOrder] = useState<string[]>([]);

  useEffect(() => {
    setLoadingSession(true);
    setError(null);
    getSession(sessionId)
      .then(({ session, turns }) => {
        setTopic(session.topic);
        setStatus(session.status);
        setTurns(turns);
        setAgentOrder(session.agents.map((a) => a.name));
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingSession(false));
  }, [sessionId]);

  function colorForSpeaker(speaker: string): string {
    const index = agentOrder.indexOf(speaker);
    return agentColorClass(index === -1 ? 0 : index);
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

  async function handleEnd() {
    await endSession(sessionId).catch(() => {});
    setStatus("ended");
  }

  if (loadingSession) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12 text-muted-foreground">
        Loading debate…
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Debate</h1>
          <p className="mt-1 text-sm text-muted-foreground">{topic}</p>
        </div>
        <p className="whitespace-nowrap text-xs text-muted-foreground">
          this debate: ${debateCost.toFixed(4)}
        </p>
      </div>

      <div className="space-y-4">
        {turns.map((turn) => (
          <Card key={turn.turn_index}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                <Badge className={colorForSpeaker(turn.speaker)}>{turn.speaker}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="whitespace-pre-wrap text-sm">{turn.text}</CardContent>
          </Card>
        ))}

        {loading && (
          <Card>
            <CardContent className="space-y-2 pt-6 text-sm text-muted-foreground">
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
            </CardContent>
          </Card>
        )}
      </div>

      {budgetExceeded ? (
        <Card className="mt-4 border-destructive/50">
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
        error && <p className="mt-4 text-sm text-destructive">{error}</p>
      )}

      <div className="mt-6 flex gap-3">
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
    </main>
  );
}
