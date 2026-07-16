"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSession, nextTurnStream, endSession, type Turn } from "@/lib/api";
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

  useEffect(() => {
    setLoadingSession(true);
    setError(null);
    getSession(sessionId)
      .then(({ session, turns }) => {
        setTopic(session.topic);
        setStatus(session.status);
        setTurns(turns);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingSession(false));
  }, [sessionId]);

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
            { turn_index: event.turn_index, speaker: event.speaker, text: event.text },
          ]);
          setSearchTrace([]);
        }
      });
    } catch (e) {
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Debate</h1>
        <p className="mt-1 text-sm text-muted-foreground">{topic}</p>
      </div>

      <div className="space-y-4">
        {turns.map((turn) => (
          <Card key={turn.turn_index}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                <Badge variant="secondary">{turn.speaker}</Badge>
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

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex gap-3">
        {status === "active" ? (
          <>
            <Button onClick={handleNextTurn} disabled={loading}>
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
