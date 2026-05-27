const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface Agent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  model: string;
  max_tokens: number;
  timeout_seconds: number;
  is_builtin: boolean;
  created_at: string;
  updated_at: string;
}

export interface Run {
  id: string;
  agent_id: string;
  schedule_id: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  triggered_by: string;
  input_params: Record<string, unknown>;
  output: string | null;
  error: string | null;
  tokens_input: number | null;
  tokens_output: number | null;
  cost_usd: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface Schedule {
  id: string;
  agent_id: string;
  name: string;
  cron_expression: string;
  input_params: Record<string, unknown>;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

export interface Stats {
  runs_today: number;
  runs_this_month: number;
  active_runs: number;
  status_counts: Record<string, number>;
  runs_by_agent_this_month: Record<string, number>;
}

export interface LogEntry {
  id: number;
  run_id: string;
  level: "info" | "tool_use" | "tool_result" | "error" | "done";
  message: string;
  extra: Record<string, unknown> | null;
  created_at: string;
}

export interface HealthStatus {
  status: "ok" | "degraded";
  version: string;
  services: { redis: boolean; database: boolean };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (res.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export const api = {
  agents: {
    list: () => apiFetch<Agent[]>("/api/agents"),
    get: (id: string) => apiFetch<Agent>(`/api/agents/${id}`),
    create: (data: Partial<Agent>) =>
      apiFetch<Agent>("/api/agents", { method: "POST", body: JSON.stringify(data) }),
  },
  runs: {
    list: (params?: { agent_id?: string; status?: string; limit?: number }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString();
      return apiFetch<Run[]>(`/api/runs${qs ? `?${qs}` : ""}`);
    },
    get: (id: string) => apiFetch<Run>(`/api/runs/${id}`),
    create: (agent_id: string, input_params: Record<string, unknown>) =>
      apiFetch<Run>("/api/runs", { method: "POST", body: JSON.stringify({ agent_id, input_params }) }),
    cancel: (id: string) => apiFetch<void>(`/api/runs/${id}`, { method: "DELETE" }),
    getLogs: (id: string) => apiFetch<LogEntry[]>(`/api/runs/${id}/logs`),
  },
  schedules: {
    list: () => apiFetch<Schedule[]>("/api/schedules"),
    create: (data: Partial<Schedule>) =>
      apiFetch<Schedule>("/api/schedules", { method: "POST", body: JSON.stringify(data) }),
    toggle: (id: string) =>
      apiFetch<Schedule>(`/api/schedules/${id}/toggle`, { method: "POST" }),
    runNow: (id: string) =>
      apiFetch<Run>(`/api/schedules/${id}/run-now`, { method: "POST" }),
    delete: (id: string) =>
      apiFetch<void>(`/api/schedules/${id}`, { method: "DELETE" }),
  },
  stats: () => apiFetch<Stats>("/api/stats"),
  health: () => apiFetch<HealthStatus>("/api/health"),
};
