"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, Scale, Settings2 } from "lucide-react";
import {
  listModels,
  createSession,
  runConcierge,
  ApiError,
  type AgentDraft,
  type AgentMode,
  type ClarifyOption,
  type ConciergeResult,
  type IntakeLink,
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
import { DEFAULT_AGENTS, TEMPLATES, type DebateTemplate } from "@/lib/templates";

const DEFAULT_JUDGE: JudgeConfig = { enabled: true, model: "moonshotai/kimi-k2.5" };

export default function NewDebatePage() {
  const router = useRouter();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [topic, setTopic] = useState("");
  const [agents, setAgents] = useState<AgentDraft[]>(DEFAULT_AGENTS);
  const [judge, setJudge] = useState<JudgeConfig>(DEFAULT_JUDGE);
  const [templateId, setTemplateId] = useState("open");
  const [configOpen, setConfigOpen] = useState(false);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  // Which stance fields the user has hand-edited — those stop live-syncing
  // with the template composition. Clearing a field hands it back.
  const stanceEditedRef = useRef<boolean[]>([]);
  // The intake flow: compose -> concierge "thinking" -> either the room opens,
  // or a clarify card / inline answer is shown. Editing the prompt drops back
  // to compose (see the topic onChange).
  const [phase, setPhase] = useState<"compose" | "thinking" | "clarify" | "answer">("compose");
  const [concierge, setConcierge] = useState<ConciergeResult | null>(null);
  const [otherInput, setOtherInput] = useState("");
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
    // In an advise room, a new agent joins as another advisor; in advocate
    // or open rooms it joins as a neutral participant (a free evaluator
    // between two advocates is useful structure, not a bug).
    const adviseRoom = agents.length > 0 && agents.every((a) => a.mode === "advise");
    setAgents((prev) => [
      ...prev,
      {
        name: `${adviseRoom ? "Advisor" : "Agent"} ${letter}`,
        model: "",
        use_search: false,
        ...(adviseRoom ? { mode: "advise" as const } : {}),
      },
    ]);
  }

  function removeAgent(i: number) {
    setAgents((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Selecting a template never types into the topic box — it swaps the
  // placeholder and agent lineup (advocate templates arrive with stances
  // already filled, which then track the typed subject live).
  function applyTemplate(template: DebateTemplate) {
    setTemplateId(template.id);
    setTopic("");
    stanceEditedRef.current = [];
    const composed = template.composeStances?.("") ?? [];
    setAgents(template.agents.map((a, i) => ({ ...a, stance: composed[i] || a.stance })));
    requestAnimationFrame(() => topicRef.current?.focus());
  }

  const activeTemplate = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const composedStances = activeTemplate.composeStances?.(topic.trim()) ?? [];
  const personaPlaceholder =
    activeTemplate.personaPlaceholder ??
    "e.g. A cautious economist who prioritizes empirical evidence over theory";

  // Keep un-edited stance fields tracking the typed subject.
  useEffect(() => {
    const compose = activeTemplate.composeStances;
    if (!compose) return;
    const composed = compose(topic.trim());
    setAgents((prev) =>
      prev.map((a, i) =>
        composed[i] && !stanceEditedRef.current[i] ? { ...a, stance: composed[i] } : a,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, templateId]);

  const trimmedNames = agents.map((a) => a.name.trim().toLowerCase());
  const hasDuplicateNames = new Set(trimmedNames).size !== trimmedNames.length;
  const hasEmptyName = agents.some((a) => !a.name.trim());
  const hasEmptyModel = agents.some((a) => !a.model);
  const hasEmptyTopic = !topic.trim();
  const judgeInvalid = judge.enabled && !judge.model;
  const configValid = !hasDuplicateNames && !hasEmptyName && !hasEmptyModel && !judgeInvalid;
  const canStart = configValid && !hasEmptyTopic;

  // What kind of room this is, for the concierge — an advocate room clarifies a
  // bare topic into a proposition, an advise room needs a concrete idea.
  const roomMode: AgentMode = agents.some((a) => a.mode === "advocate" || a.stance)
    ? "advocate"
    : agents.length > 0 && agents.every((a) => a.mode === "advise")
      ? "advise"
      : "discuss";

  const summary =
    agents.length > 0
      ? agents
          .filter((a) => a.model)
          .map((a) => shortModelName(a.model))
          .join(agents.length === 2 ? " vs " : ", ")
      : "";

  function handleStartError(e: unknown) {
    if (e instanceof ApiError && e.status === 402) setBudgetExceeded(true);
    setError((e as Error).message);
    setPhase("compose");
  }

  // Compose the chosen input into the room's real topic/stances (unchanged from
  // before the concierge) and open it. `subject` is what the user sees in the
  // header; `composeInput` is what the template wraps into the agents' topic.
  async function openRoom(composeInput: string, subject: string, intake?: IntakeLink) {
    const finalTopic = activeTemplate.composeTopic
      ? activeTemplate.composeTopic(composeInput)
      : composeInput;
    const stances = activeTemplate.composeStances?.(composeInput) ?? [];
    // Hand-written stances in the config sheet always win over composition.
    const finalAgents = agents.map((a, i) =>
      !a.stance && stances[i] ? { ...a, stance: stances[i] } : a,
    );
    const res = await createSession(
      finalTopic,
      finalAgents,
      judge,
      subject,
      activeTemplate.id === "open" ? null : activeTemplate.label,
      intake,
    );
    router.push(`/debate/${res.session_id}`);
  }

  async function startDebate() {
    if (!canStart || phase === "thinking") return;
    setError(null);
    setBudgetExceeded(false);
    setPhase("thinking");
    const input = topic.trim();

    let result: ConciergeResult | null = null;
    try {
      result = await runConcierge(input, activeTemplate.id === "open" ? null : activeTemplate.label, roomMode);
    } catch (e) {
      // Out of budget is terminal; any other concierge failure just falls
      // through to opening the room the old way — intake never blocks a debate.
      if (e instanceof ApiError && e.status === 402) return handleStartError(e);
      result = null;
    }

    try {
      if (result?.decision === "clarify" && result.clarify) {
        setConcierge(result);
        setPhase("clarify");
      } else if (result?.decision === "answer") {
        setConcierge(result);
        setPhase("answer");
      } else if (result?.decision === "discuss") {
        await openRoom(result.refined_input, input, {
          intake_id: result.intake_id,
          interpretation: result.interpretation,
          resolved: result.resolved,
        });
      } else {
        await openRoom(input, input); // concierge unavailable — today's behavior
      }
    } catch (e) {
      handleStartError(e);
    }
  }

  // Every path out of a clarify/answer card ends here: open the room from a
  // chosen input, still linked to the intake row that produced it.
  async function openFromIntake(composeInput: string, subject: string) {
    setError(null);
    setPhase("thinking");
    try {
      await openRoom(composeInput, subject, concierge ? { intake_id: concierge.intake_id, interpretation: "", resolved: false } : undefined);
    } catch (e) {
      handleStartError(e);
    }
  }

  function chooseOption(o: ClarifyOption) {
    openFromIntake(o.refined_input, o.refined_input);
  }

  function submitOther() {
    const v = otherInput.trim();
    if (v) openFromIntake(v, v);
  }

  function resetToCompose() {
    setPhase("compose");
    setConcierge(null);
    setOtherInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      startDebate();
    }
  }

  return (
    <main className="flex h-full flex-col items-center justify-center overflow-y-auto px-4 sm:px-6">
      <div className="w-full max-w-2xl">
        <h1 className="mb-6 text-center text-2xl sm:text-3xl">What should we discuss?</h1>

        <InputGroup className="h-auto bg-card dark:bg-card">
          <InputGroupTextarea
            ref={topicRef}
            placeholder={activeTemplate.placeholder}
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (phase !== "compose") resetToCompose();
            }}
            onKeyDown={handleKeyDown}
            rows={3}
            autoFocus
          />
          <InputGroupAddon align="block-end">
            <span
              className={
                configValid
                  ? "min-w-0 flex-1 truncate text-sm text-foreground"
                  : "min-w-0 flex-1 truncate text-sm text-destructive"
              }
              title={configValid ? `Discussing with ${summary}` : undefined}
            >
              {configValid ? `Discussing with ${summary}` : "Fix agent configuration"}
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
              disabled={phase === "thinking" || !canStart || budgetExceeded}
              onClick={startDebate}
              aria-label="Start discussion"
            >
              {phase === "thinking" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        {phase === "compose" && (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyTemplate(t)}
                  title={t.label}
                  className={`truncate rounded-full border px-3 py-1.5 text-center text-xs transition-colors ${
                    templateId === t.id
                      ? "border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {activeTemplate.composeTopic && topic.trim() && (
              <p className="mt-2 truncate text-center text-xs text-muted-foreground">
                Will start: &ldquo;{activeTemplate.composeTopic(topic.trim())}&rdquo;
              </p>
            )}
          </>
        )}

        {phase === "thinking" && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading your prompt&hellip;
          </div>
        )}

        {phase === "clarify" && concierge?.clarify && (
          <Card className="mt-4">
            <CardContent className="space-y-3 pt-6">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                A quick check
              </p>
              <p className="text-base text-foreground">{concierge.clarify.question}</p>
              <div className="space-y-2">
                {concierge.clarify.options.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => chooseOption(o)}
                    className="w-full rounded-lg border px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:border-foreground"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Input
                  value={otherInput}
                  onChange={(e) => setOtherInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitOther();
                    }
                  }}
                  placeholder="Something else — type your own…"
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={submitOther} disabled={!otherInput.trim()}>
                  Use this
                </Button>
              </div>
              <button
                onClick={() => openFromIntake(topic.trim(), topic.trim())}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Just start with what I typed
              </button>
            </CardContent>
          </Card>
        )}

        {phase === "answer" && concierge && (
          <Card className="mt-4">
            <CardContent className="space-y-3 pt-6">
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Quick answer
              </p>
              <p className="whitespace-pre-wrap text-base text-foreground">{concierge.answer}</p>
              <p className="text-sm text-muted-foreground">
                That&rsquo;s a quick one — but I&rsquo;m built for something richer. Want a real
                back-and-forth on it?
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openFromIntake(topic.trim(), topic.trim())}
                >
                  Discuss this anyway
                </Button>
                <button
                  onClick={() => {
                    resetToCompose();
                    setTopic("");
                    requestAnimationFrame(() => topicRef.current?.focus());
                  }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Ask something else
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {budgetExceeded ? (
          <Card className="mt-4 border-destructive/50">
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
          error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>
        )}
      </div>

      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent className="flex flex-col overflow-hidden">
          <SheetHeader className="pt-6 pr-10">
            <SheetTitle>Discussion configuration</SheetTitle>
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

                  <details open={!!agent.stance || !!composedStances[i]}>
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      + Position they argue (optional)
                    </summary>
                    <div className="mt-2 space-y-1">
                      <Textarea
                        value={agent.stance || ""}
                        onChange={(e) => {
                          // Hand-editing detaches the field from the template
                          // composition; clearing it re-attaches.
                          stanceEditedRef.current[i] = e.target.value !== "";
                          updateAgent(i, { stance: e.target.value });
                        }}
                        maxLength={300}
                        rows={2}
                        placeholder="e.g. Argue that remote work improves productivity — defend it honestly"
                      />
                      <p className="text-xs text-muted-foreground">
                        {composedStances[i] && !stanceEditedRef.current[i]
                          ? "Follows your topic automatically — edit to take over, clear to re-attach."
                          : "The agent argues this position honestly — it concedes points it can't defend rather than making things up."}
                      </p>
                      <p className="text-right text-xs text-muted-foreground">
                        {(agent.stance || "").length}/300
                      </p>
                    </div>
                  </details>

                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                      + Voice &amp; style (optional)
                    </summary>
                    <div className="mt-2 space-y-1">
                      <Textarea
                        value={agent.persona || ""}
                        onChange={(e) => updateAgent(i, { persona: e.target.value })}
                        maxLength={500}
                        rows={2}
                        placeholder={personaPlaceholder}
                      />
                      <p className="text-xs text-muted-foreground">
                        Shapes tone and character — not their position.
                      </p>
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
              <p className="mb-2 flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-muted-foreground">
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
                    Reviews the discussion after each round and can pressure-test a consensus or
                    pull the agents back on topic. Its remarks stay out of the discussion unless
                    you ask it to step in.
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
