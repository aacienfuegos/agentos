const BASE_URL = "";

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
  session_id: string | null;
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
  scheduled_jobs: number;
  status_counts: Record<string, number>;
  runs_by_agent_this_month: Record<string, number>;
  tokens_this_month: { input: number; output: number; total: number };
  cost_this_month_usd: number;
  cost_by_agent: Record<string, number>;
  monthly_budget_usd: number;
  budget_exceeded: boolean;
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
  services: { redis: boolean; database: boolean; claude: boolean };
}

export interface ApiKey {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  enabled: boolean;
}

export interface ApiKeyCreated extends ApiKey {
  raw_key: string;
}

export interface ExecuteRequest {
  prompt: string;
  system_prompt?: string;
  model?: string;
  timeout_seconds?: number;
  async?: boolean;
}

export interface ExecuteResponse {
  output: string;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number | null;
  run_id: string;
}

export interface ExecuteAsyncResponse {
  run_id: string;
  status: string;
}

export interface KnowledgeAgent {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  knowledge_path: string;
  model: string;
  tools: string[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFile {
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
}

export interface KnowledgeTool {
  name: string;
  description: string;
  group: "filesystem" | "web" | "sistema" | "avanzado";
}

export const KNOWLEDGE_TOOLS: KnowledgeTool[] = [
  { name: "Read",         description: "Leer ficheros",                               group: "filesystem" },
  { name: "Write",        description: "Escribir ficheros (actualizar el documento)",  group: "filesystem" },
  { name: "Edit",         description: "Ediciones quirúrgicas en ficheros",            group: "filesystem" },
  { name: "Glob",         description: "Buscar ficheros por patrón",                  group: "filesystem" },
  { name: "Grep",         description: "Buscar texto en ficheros",                    group: "filesystem" },
  { name: "LS",           description: "Listar directorios",                          group: "filesystem" },
  { name: "WebFetch",     description: "Descargar URLs concretas",                    group: "web" },
  { name: "WebSearch",    description: "Buscar en internet",                          group: "web" },
  { name: "Bash",         description: "Ejecutar comandos shell",                     group: "sistema" },
  { name: "Task",         description: "Lanzar subagentes",                           group: "avanzado" },
  { name: "NotebookRead", description: "Leer notebooks Jupyter",                      group: "avanzado" },
  { name: "NotebookEdit", description: "Editar notebooks Jupyter",                    group: "avanzado" },
];

export const KNOWLEDGE_TOOL_GROUPS: { key: KnowledgeTool["group"]; label: string }[] = [
  { key: "filesystem", label: "Filesystem" },
  { key: "web",        label: "Web" },
  { key: "sistema",    label: "Sistema" },
  { key: "avanzado",   label: "Avanzado" },
];

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
    update: (id: string, data: Partial<Agent>) =>
      apiFetch<Agent>(`/api/agents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      apiFetch<void>(`/api/agents/${id}`, { method: "DELETE" }),
  },
  runs: {
    list: (params?: { agent_id?: string; statuses?: string[]; limit?: number; offset?: number }) => {
      const p = new URLSearchParams();
      if (params?.agent_id) p.set("agent_id", params.agent_id);
      if (params?.limit !== undefined) p.set("limit", String(params.limit));
      if (params?.offset !== undefined) p.set("offset", String(params.offset));
      for (const s of params?.statuses ?? []) p.append("status", s);
      const qs = p.toString();
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
  apiKeys: {
    list: () => apiFetch<ApiKey[]>("/api/api-keys"),
    create: (name: string) =>
      apiFetch<ApiKeyCreated>("/api/api-keys", { method: "POST", body: JSON.stringify({ name }) }),
    delete: (id: string) =>
      apiFetch<void>(`/api/api-keys/${id}`, { method: "DELETE" }),
  },
  execute: (req: ExecuteRequest) =>
    apiFetch<ExecuteResponse | ExecuteAsyncResponse>("/api/execute", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  knowledgeAgents: {
    list: () => apiFetch<KnowledgeAgent[]>("/api/knowledge-agents"),
    get: (id: string) => apiFetch<KnowledgeAgent>(`/api/knowledge-agents/${id}`),
    create: (data: Partial<KnowledgeAgent>) =>
      apiFetch<KnowledgeAgent>("/api/knowledge-agents", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<KnowledgeAgent>) =>
      apiFetch<KnowledgeAgent>(`/api/knowledge-agents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      apiFetch<void>(`/api/knowledge-agents/${id}`, { method: "DELETE" }),
    files: {
      list: (id: string) =>
        apiFetch<KnowledgeFile[]>(`/api/knowledge-agents/${id}/files`),
      get: (id: string, path: string) =>
        fetch(`${BASE_URL}/api/knowledge-agents/${id}/files/${path}`, { credentials: "include" })
          .then((r) => { if (!r.ok) throw new Error(`API error ${r.status}`); return r.text(); }),
      update: (id: string, path: string, content: string) =>
        apiFetch<KnowledgeFile>(`/api/knowledge-agents/${id}/files/${path}`, {
          method: "PUT",
          body: content,
          headers: { "Content-Type": "text/plain" },
        }),
      delete: (id: string, path: string) =>
        apiFetch<void>(`/api/knowledge-agents/${id}/files/${path}`, { method: "DELETE" }),
      upload: async (id: string, files: File[]): Promise<{ written: string[]; errors: string[] }> => {
        const formData = new FormData();
        for (const file of files) {
          // webkitRelativePath preserves folder structure when uploading a directory
          const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          formData.append("files", file, path);
        }
        const res = await fetch(`${BASE_URL}/api/knowledge-agents/${id}/upload`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        if (res.status === 401) {
          if (typeof window !== "undefined" && window.location.pathname !== "/login")
            window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
          throw new Error("Unauthorized");
        }
        if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
        return res.json();
      },
    },
    query: (id: string, userMessage: string, resumeSessionId?: string, conversationId?: string, tools?: string[]) =>
      apiFetch<{ run_id: string }>(`/api/knowledge-agents/${id}/query`, {
        method: "POST",
        body: JSON.stringify({
          user_message: userMessage,
          ...(resumeSessionId ? { resume_session_id: resumeSessionId } : {}),
          ...(conversationId ? { conversation_id: conversationId } : {}),
          ...(tools ? { tools } : {}),
        }),
      }),
  },
};
