"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Settings2 } from "lucide-react";
import { listModels, createSession, ApiError, type AgentDraft, type ModelInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ModelCombobox } from "@/components/model-combobox";

const TOPIC_PLACEHOLDER =
  "What should the agents debate? e.g. Can a debate between multiple models lead to more factually correct research than using one model alone?";

const DEFAULT_AGENTS: AgentDraft[] = [
  { name: "Agent A", model: "deepseek/deepseek-v4-pro", use_search: true },
  { name: "Agent B", model: "moonshotai/kimi-k2.5", use_search: true },
];

function shortModelName(id: string): string {
  const slug = id.split("/")[1] || id;
  return slug
    .split("-")
    .map((w) => (w.length <= 3 && /\d/.test(w) ? w.toUpperCase() : w[0]?.toUpperCase() + w.slice(1)))
    .join(" ");
}

export default function NewDebatePage() {
  const router = useRouter();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [topic, setTopic] = useState("");
  const [agents, setAgents] = useState<AgentDraft[]>(DEFAULT_AGENTS);
  const [configOpen, setConfigOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetExceeded, setBudgetExceeded] = useState(false);

  useEffect(() => {
    listModels()
      .then(setModels)
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
  const configValid = !hasDuplicateNames && !hasEmptyName && !hasEmptyModel;
  const canStart = configValid && !hasEmptyTopic;

  const summary =
    agents.length > 0
      ? agents
          .filter((a) => a.model)
          .map((a) => shortModelName(a.model))
          .join(agents.length === 2 ? " vs " : ", ")
      : "";

  async function startDebate() {
    if (!canStart) return;
    setError(null);
    setLoading(true);
    try {
      const res = await createSession(topic, agents);
      router.push(`/debate/${res.session_id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        setBudgetExceeded(true);
      }
      setError((e as Error).message);
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startDebate();
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-2xl font-semibold">What should they debate?</h1>

        <InputGroup className="h-auto">
          <InputGroupTextarea
            placeholder={TOPIC_PLACEHOLDER}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            autoFocus
          />
          <InputGroupAddon align="block-end">
            <span className="text-xs text-muted-foreground">
              {configValid ? `Debating with ${summary}` : "Fix agent configuration"}
            </span>
            <InputGroupButton
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setConfigOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Configure
            </InputGroupButton>
            <InputGroupButton
              variant="default"
              size="icon-sm"
              disabled={loading || !canStart || budgetExceeded}
              onClick={startDebate}
              aria-label="Start debate"
            >
              <ArrowUp className="h-4 w-4" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

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
          error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>
        )}
      </div>

      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent className="flex flex-col overflow-hidden">
          <SheetHeader>
            <SheetTitle>Debate configuration</SheetTitle>
            <SheetDescription>Choose the agents, their models, and web search access.</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
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
                    <ModelCombobox
                      models={models}
                      value={agent.model}
                      onChange={(id) => updateAgent(i, { model: id })}
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

            {hasDuplicateNames && (
              <p className="text-xs text-destructive">Agent names must be unique.</p>
            )}

            <Button variant="outline" className="w-full" onClick={addAgent}>
              + Add agent
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
