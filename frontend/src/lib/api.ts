import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function authHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...init.headers,
  };
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export type AgentDraft = { name: string; model: string; use_search: boolean };
export type Turn = { turn_index: number; speaker: string; text: string };
export type ModelInfo = { id: string; pricing: Record<string, string> };

export function listModels(): Promise<ModelInfo[]> {
  return apiFetch("/api/models");
}

export function createSession(topic: string, agents: AgentDraft[]) {
  return apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify({ topic, agents }),
  }) as Promise<{ session_id: string; topic: string; agents: AgentDraft[] }>;
}

export function nextTurn(sessionId: string): Promise<Turn> {
  return apiFetch(`/api/sessions/${sessionId}/next`, { method: "POST" });
}

export function endSession(sessionId: string) {
  return apiFetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
}
