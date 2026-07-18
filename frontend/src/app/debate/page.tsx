"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Scale, Settings2 } from "lucide-react";
import {
  listModels,
  createSession,
  ApiError,
  type AgentDraft,
  type JudgeConfig,
  type ModelInfo,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { shortModelName } from "@/lib/models";

const TOPIC_PLACEHOLDER =
  "What should the agents debate? e.g. Can a debate between multiple models lead to more factually correct research than using one model alone?";

const DEFAULT_AGENTS: AgentDraft[] = [
  { name: "Agent A", model: "deepseek/deepseek-v4-pro", use_search: true },
  { name: "Agent B", model: "moonshotai/kimi-k2.5", use_search: true },
];

const DEFAULT_JUDGE: JudgeConfig = { enabled: true, model: "moonshotai/kimi-k2.5" };

export default function NewDebatePage() {
  const router = useRouter();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [topic, setTopic] = useState("");
  const [agents, setAgents] = useState<AgentDraft[]>(DEFAULT_AGENTS);
  const [judge, setJudge] = useState<JudgeConfig>(DEFAULT_JUDGE);
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
  const judgeInvalid = judge.enabled && !judge.model;
  const configValid = !hasDuplicateNames && !hasEmptyName && !hasEmptyModel && !judgeInvalid;
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
      const res = await createSession(topic, agents, judge);
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
    <main className="flex h-full flex-col items-center justify-center overflow-y-auto px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-3xl">What should they debate?</h1>

        <InputGroup className="h-auto bg-card dark:bg-card">
          <InputGroupTextarea
            placeholder={TOPIC_PLACEHOLDER}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            autoFocus
          />
          <InputGroupAddon align="block-end">
            <span
              className={
                configValid
                  ? "text-sm font-medium text-indigo-600 dark:text-indigo-400"
                  : "text-sm font-medium text-destructive"
              }
            >
              {configValid ? `Debating with ${summary}` : "Fix agent configuration"}
            </span>
            <InputGroupButton
              variant="ghost"
              size="sm"
              className="ml-auto text-foreground hover:text-foreground"
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
          <SheetHeader className="pt-6 pr-10">
            <SheetTitle>Debate configuration</SheetTitle>
            <SheetDescription>Choose the agents, their models, and web search access.</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-1">
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

                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      + Persona (optional)
                    </summary>
                    <div className="mt-2 space-y-1">
                      <Textarea
                        value={agent.persona || ""}
                        onChange={(e) => updateAgent(i, { persona: e.target.value })}
                        maxLength={500}
                        rows={2}
                        placeholder="e.g. A cautious economist who prioritizes empirical evidence over theory"
                      />
                      <p className="text-right text-xs text-muted-foreground">
                        {(agent.persona || "").length}/500
                      </p>
                    </div>
                  </details>
                </CardContent>
              </Card>
            ))}

            {hasDuplicateNames && (
              <p className="text-xs text-destructive">Agent names must be unique.</p>
            )}

            <Button variant="outline" className="w-full" onClick={addAgent}>
              + Add agent
            </Button>

            <div className="pt-2">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Scale className="h-3.5 w-3.5" /> Judge
              </p>
              <Card className="border-dashed">
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={judge.enabled}
                      onCheckedChange={(checked) => setJudge((j) => ({ ...j, enabled: checked }))}
                    />
                    <Label>Enable judge</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Reviews the debate after each round and can pressure-test a consensus or pull
                    the agents back on topic. Its remarks stay out of the debate unless you ask it
                    to step in.
                  </p>
                  {judge.enabled && (
                    <div className="space-y-1.5">
                      <Label>Model</Label>
                      <ModelCombobox
                        models={models}
                        value={judge.model}
                        onChange={(id) => setJudge((j) => ({ ...j, model: id }))}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
