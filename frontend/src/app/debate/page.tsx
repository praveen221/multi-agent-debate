"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  listModels,
  createSession,
  nextTurn,
  endSession,
  type AgentDraft,
  type Turn,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

const DEFAULT_TOPIC =
  "Can a debate and discussion between multiple models and agents lead to better and more factually correct research rather than using one model?";

export default function DebatePage() {
  const router = useRouter();

  const [checking, setChecking] = useState(true);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [agents, setAgents] = useState<AgentDraft[]>([
    { name: "Agent A", model: "", use_search: false },
    { name: "Agent B", model: "", use_search: false },
  ]);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace("/");
        return;
      }
      setChecking(false);
      listModels()
        .then((models) => setModelIds(models.map((m) => m.id)))
        .catch(() => {});
    });
  }, [router]);

  function updateAgent(i: number, patch: Partial<AgentDraft>) {
    setAgents((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  function addAgent() {
    const letter = String.fromCharCode(65 + agents.length);
    setAgents((prev) => [...prev, { name: `Agent ${letter}`, model: "", use_search: false }]);
  }

  function removeAgent(i: number) {
    setAgents((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function startDebate() {
    setError(null);
    setLoading(true);
    try {
      const res = await createSession(topic, agents);
      setSessionId(res.session_id);
      setTurns([]);
      setEnded(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNextTurn() {
    if (!sessionId) return;
    setError(null);
    setLoading(true);
    try {
      const turn = await nextTurn(sessionId);
      setTurns((prev) => [...prev, turn]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnd() {
    if (!sessionId) return;
    await endSession(sessionId).catch(() => {});
    setEnded(true);
  }

  function newDebate() {
    setSessionId(null);
    setTurns([]);
    setEnded(false);
    setError(null);
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!sessionId) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Set up your debate</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
            <ThemeToggle />
          </div>
        </div>

        <div className="mb-6 space-y-2">
          <Label htmlFor="topic">Topic</Label>
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
          />
        </div>

        <div className="space-y-4">
          {agents.map((agent, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-center justify-between gap-3">
                  <Input
                    value={agent.name}
                    onChange={(e) => updateAgent(i, { name: e.target.value })}
                    className="max-w-[200px]"
                  />
                  {agents.length > 2 && (
                    <Button variant="ghost" size="sm" onClick={() => removeAgent(i)}>
                      Remove
                    </Button>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Model</Label>
                  <Input
                    list="model-options"
                    value={agent.model}
                    onChange={(e) => updateAgent(i, { model: e.target.value })}
                    placeholder="type to search…"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    checked={agent.use_search}
                    onCheckedChange={(checked) => updateAgent(i, { use_search: checked })}
                  />
                  <Label>Give this agent web search</Label>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <datalist id="model-options">
          {modelIds.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>

        <div className="mt-6 flex gap-3">
          <Button variant="outline" onClick={addAgent}>
            + Add agent
          </Button>
          <Button onClick={startDebate} disabled={loading || agents.some((a) => !a.model)}>
            {loading ? "Starting…" : "Start debate"}
          </Button>
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
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
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
          <ThemeToggle />
        </div>
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
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 flex gap-3">
        {!ended ? (
          <>
            <Button onClick={handleNextTurn} disabled={loading}>
              {loading ? "Thinking…" : "Next turn"}
            </Button>
            <Button variant="outline" onClick={handleEnd} disabled={loading}>
              End debate
            </Button>
          </>
        ) : (
          <Button onClick={newDebate}>Start a new debate</Button>
        )}
      </div>
    </main>
  );
}
