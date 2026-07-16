"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { listModels, createSession, type AgentDraft } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const DEFAULT_TOPIC =
  "Can a debate and discussion between multiple models and agents lead to better and more factually correct research rather than using one model?";

const DEFAULT_AGENTS: AgentDraft[] = [
  { name: "Agent A", model: "deepseek/deepseek-v4-pro", use_search: true },
  { name: "Agent B", model: "moonshotai/kimi-k2.5", use_search: true },
];

export default function NewDebatePage() {
  const router = useRouter();
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [agents, setAgents] = useState<AgentDraft[]>(DEFAULT_AGENTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listModels()
      .then((models) => setModelIds(models.map((m) => m.id)))
      .catch(() => {});
  }, []);

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

  const trimmedNames = agents.map((a) => a.name.trim().toLowerCase());
  const hasDuplicateNames = new Set(trimmedNames).size !== trimmedNames.length;
  const hasEmptyName = agents.some((a) => !a.name.trim());
  const hasEmptyModel = agents.some((a) => !a.model);
  const hasEmptyTopic = !topic.trim();
  const canStart = !hasDuplicateNames && !hasEmptyName && !hasEmptyModel && !hasEmptyTopic;

  async function startDebate() {
    if (!canStart) return;
    setError(null);
    setLoading(true);
    try {
      const res = await createSession(topic, agents);
      router.push(`/debate/${res.session_id}`);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">Set up your debate</h1>

      <div className="mb-6 space-y-2">
        <Label htmlFor="topic">Topic</Label>
        <Textarea id="topic" value={topic} onChange={(e) => setTopic(e.target.value)} rows={3} />
        {hasEmptyTopic && <p className="text-xs text-destructive">Topic can&apos;t be empty.</p>}
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

      {hasDuplicateNames && (
        <p className="mt-2 text-xs text-destructive">Agent names must be unique.</p>
      )}

      <div className="mt-6 flex gap-3">
        <Button variant="outline" onClick={addAgent}>
          + Add agent
        </Button>
        <Button onClick={startDebate} disabled={loading || !canStart}>
          {loading ? "Starting…" : "Start debate"}
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
    </main>
  );
}
