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

export type AgentDraft = { name: string; model: string; use_search: boolean };
export type Turn = { turn_index: number; speaker: string; text: string; cost_usd?: number };
export type ModelInfo = { id: string; pricing: Record<string, string> };
export type Credits = { spent_usd: number; limit_usd: number };
export type SessionSummary = {
  session_id: string;
  topic: string;
  status: string;
  created_at: string;
};
export type SessionDetail = {
  session: { id: string; topic: string; status: string; agents: AgentDraft[] };
  turns: Turn[];
};
export type StreamEvent =
  | { type: "search"; query: string }
  | {
      type: "turn";
      turn_index: number;
      speaker: string;
      text: string;
      cost_usd: number;
      total_spent_usd: number;
    };

export function listModels(): Promise<ModelInfo[]> {
  return apiFetch("/api/models");
}

export function getCredits(): Promise<Credits> {
  return apiFetch("/api/credits");
}

export function createSession(topic: string, agents: AgentDraft[]) {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ topic, agents }),
  }) as Promise<{ session_id: string; topic: string; agents: AgentDraft[] }>;
}

export function listSessions(): Promise<SessionSummary[]> {
  return apiFetch("/api/sessions");
}

export function getSession(sessionId: string): Promise<SessionDetail> {
  return apiFetch(`/api/sessions/${sessionId}`);
}

export function endSession(sessionId: string) {
  return apiFetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
}

export async function nextTurnStream(
  sessionId: string,
  onEvent: (event: StreamEvent) => void,
) {
  const headers = { "Content-Type": "application/json", ...(await authHeader()) };
  const res = await fetch(`${API_URL}/api/sessions/${sessionId}/next`, {
    method: "POST",
    headers,
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
      // A mid-stream failure — surface it the same way a rejected fetch
      // would, so callers only need one catch block, not a special case.
      if (parsed.type === "error") throw new Error(parsed.message);
      onEvent(parsed as StreamEvent);
    }
  }
}
