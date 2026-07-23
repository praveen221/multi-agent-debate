import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function throwForResponse(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new ApiError(res.status, body.detail || `Request failed: ${res.status}`);
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...init.headers,
  };
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) await throwForResponse(res);
  return res.json();
}

export type AgentMode = "discuss" | "advocate" | "advise";
export type AgentDraft = {
  name: string;
  model: string;
  use_search: boolean;
  persona?: string;
  mode?: AgentMode;
  stance?: string;
};
export type SourceResult = { title: string; url: string; snippet: string };
export type Source = { query: string; results: SourceResult[] };
export type JudgeConfig = { enabled: boolean; model: string };
export type JudgeAction = "verdict" | "intervene" | "pressure_test" | "refocus" | "report";
export type EvidenceItem = { claim: string; sources: { title: string; url: string }[] };
export type Verdict = {
  kind: "verdict" | "intervention" | "report";
  action?: JudgeAction;
  direction?: string | null;
  summary?: string;
  agreements?: string[];
  contentions?: string[];
  suggested_action?: JudgeAction | "conclude" | "none";
  landed?: string;
  evidence?: EvidenceItem[];
  cautions?: string[];
};
export type Turn = {
  turn_index: number;
  role?: "agent" | "human" | "judge";
  speaker: string;
  text: string;
  cost_usd?: number;
  sources?: Source[];
  verdict?: Verdict | null;
};
export type ModelInfo = { id: string; pricing: Record<string, string> };
export type Credits = { spent_usd: number; limit_usd: number };
export type SessionSummary = {
  session_id: string;
  topic: string;
  title: string | null;
  status: string;
  created_at: string;
};
export type FeedbackCategory = "bug" | "idea" | "other";
export type SessionDetail = {
  session: {
    id: string;
    topic: string;
    subject?: string | null;
    template_label?: string | null;
    status: string;
    agents: AgentDraft[];
    judge?: JudgeConfig | null;
    share_id?: string | null;
    intake?: { interpretation: string; resolved: boolean } | null;
    single_agent?: SingleAgentConfig | null;
  };
  turns: Turn[];
  single_turns?: SingleTurn[];
};
export type PublicAgent = {
  name: string;
  model: string;
  use_search: boolean;
  mode?: AgentMode;
  stance?: string | null;
};
export type PublicDebate = {
  topic: string;
  subject: string;
  template_label: string | null;
  status: string;
  created_at: string;
  agents: PublicAgent[];
  turns: Turn[];
};
export type StreamEvent =
  | { type: "token"; text: string }
  | { type: "token_reset" }
  | { type: "search"; query: string }
  | { type: "search_result"; query: string; result_count: number; titles: string[] }
  | {
      type: "turn";
      turn_index: number;
      role?: "agent" | "human";
      speaker: string;
      text: string;
      cost_usd: number;
      sources?: Source[];
      total_spent_usd: number;
    };

// --- Single-model track (Phase 3) ---
export type SingleAgentConfig = { model: string; use_search: boolean };
export type FollowupOption = { label: string; instruction: string };
export type SingleTurn = {
  turn_index: number;
  role: "single" | "human" | "judge";
  text: string;
  sources?: Source[];
  option_label?: string | null;
  options?: FollowupOption[] | null;
  cost_usd?: number;
};
export type SingleStreamEvent =
  | { type: "token"; text: string }
  | { type: "token_reset" }
  | { type: "search"; query: string }
  | { type: "search_result"; query: string; result_count: number; titles: string[] }
  | {
      type: "single_intervention";
      turn_index: number;
      role: "human" | "judge";
      speaker: string;
      text: string;
    }
  | {
      type: "single_turn";
      turn_index: number;
      role: "single";
      text: string;
      cost_usd: number;
      sources?: Source[];
      option_label?: string | null;
      options: FollowupOption[];
      total_spent_usd: number;
    };

export function listModels(): Promise<ModelInfo[]> {
  return apiFetch("/api/models");
}

export function getCredits(): Promise<Credits> {
  return apiFetch("/api/credits");
}

export type ClarifyOption = { label: string; refined_input: string };
export type ConciergeResult = {
  intake_id: string;
  decision: "discuss" | "clarify" | "answer";
  interpretation: string;
  resolved: boolean;
  refined_input: string;
  clarify: { question: string; options: ClarifyOption[] } | null;
  answer: string;
};
export type IntakeLink = { intake_id: string; interpretation: string; resolved: boolean };

export function runConcierge(
  prompt: string,
  templateLabel: string | null,
  mode: AgentMode,
): Promise<ConciergeResult> {
  return apiFetch("/api/concierge", {
    method: "POST",
    body: JSON.stringify({ prompt, template_label: templateLabel, mode }),
  });
}

export function createSession(
  topic: string,
  agents: AgentDraft[],
  judge?: JudgeConfig,
  subject?: string,
  templateLabel?: string | null,
  intake?: IntakeLink,
) {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      topic,
      agents,
      judge,
      subject,
      template_label: templateLabel,
      intake,
    }),
  }) as Promise<{ session_id: string; topic: string; agents: AgentDraft[] }>;
}

export function updateSessionJudge(sessionId: string, judge: JudgeConfig) {
  return apiFetch(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ judge }),
  }) as Promise<{ judge: JudgeConfig }>;
}

export function runJudge(sessionId: string, action: JudgeAction, sourceTurnIndex?: number) {
  return apiFetch(`/api/sessions/${sessionId}/judge`, {
    method: "POST",
    body: JSON.stringify({ action, source_turn_index: sourceTurnIndex }),
  }) as Promise<Turn>;
}

export function listSessions(): Promise<SessionSummary[]> {
  return apiFetch("/api/sessions");
}

export function renameSession(sessionId: string, title: string) {
  return apiFetch(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  }) as Promise<{ title: string }>;
}

export function deleteSession(sessionId: string) {
  return apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" }) as Promise<{
    deleted: boolean;
  }>;
}

export type FeedbackTrigger = "manual" | "conclude" | "rounds";

export function sendFeedback(
  message: string,
  category: FeedbackCategory | null,
  page: string,
  rating?: number,
  triggerPoint: FeedbackTrigger = "manual",
) {
  return apiFetch("/api/feedback", {
    method: "POST",
    body: JSON.stringify({ message, category, page, rating, trigger_point: triggerPoint }),
  }) as Promise<{ ok: boolean }>;
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return apiFetch(`/api/sessions/${sessionId}`);
}

export function endSession(sessionId: string) {
  return apiFetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
}

export function shareSession(sessionId: string) {
  return apiFetch(`/api/sessions/${sessionId}/share`, { method: "POST" }) as Promise<{
    share_id: string;
  }>;
}

export function unshareSession(sessionId: string) {
  return apiFetch(`/api/sessions/${sessionId}/unshare`, { method: "POST" }) as Promise<{
    share_id: null;
  }>;
}

export function addSteerMessage(sessionId: string, text: string) {
  return apiFetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  }) as Promise<{ turn_index: number; role: "human"; speaker: string; text: string }>;
}

// Read an NDJSON stream, dispatching each line to onEvent. A mid-stream
// {type:"error"} is thrown so callers need only one catch block, not a special
// case. Shared by the debate turn stream and the single-model track.
async function streamNdjson<T>(url: string, body: unknown, onEvent: (event: T) => void) {
  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  const res = await fetch(`${API_URL}${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) await throwForResponse(res);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      if (parsed.type === "error") throw new Error(parsed.message);
      onEvent(parsed as T);
    }
  }
}

export function nextTurnStream(
  sessionId: string,
  expectedTurnIndex: number,
  onEvent: (event: StreamEvent) => void,
) {
  return streamNdjson(
    `/api/sessions/${sessionId}/next`,
    { expected_turn_index: expectedTurnIndex },
    onEvent,
  );
}

export function startSingle(
  sessionId: string,
  model: string,
  useSearch: boolean,
  onEvent: (event: SingleStreamEvent) => void,
) {
  return streamNdjson(`/api/sessions/${sessionId}/single/start`, { model, use_search: useSearch }, onEvent);
}

export function singleNext(
  sessionId: string,
  instruction: string,
  label: string,
  onEvent: (event: SingleStreamEvent) => void,
) {
  return streamNdjson(`/api/sessions/${sessionId}/single/next`, { instruction, label }, onEvent);
}

export function singleIntervene(
  sessionId: string,
  kind: "human" | "judge",
  text: string,
  onEvent: (event: SingleStreamEvent) => void,
) {
  return streamNdjson(`/api/sessions/${sessionId}/single/intervene`, { kind, text }, onEvent);
}

export function submitComparison(sessionId: string, preference: "single" | "multi") {
  return apiFetch(`/api/sessions/${sessionId}/comparison`, {
    method: "POST",
    body: JSON.stringify({ preference }),
  }) as Promise<{ preference: "single" | "multi" }>;
}
