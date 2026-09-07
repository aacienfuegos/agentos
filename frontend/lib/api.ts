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
  knowledge_base_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentGenerated {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  model: string;
  knowledge_base_id: string | null;
}

export interface Run {
  id: string;
  agent_id: string;
  schedule_id: string | null;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  triggered_by: string;
  run_type: string;
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

export interface KnowledgeConversation {
  conversation_id: string;
  knowledge_base_id: string;
  turn_count: number;
  first_at: string;
  last_at: string;
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

export interface InfraTarget {
  id: string;
  name: string;
  host: string;
  ssh_user: string;
  ssh_port: number;
  notes: string;
  known_hosts_entry: string | null;
  host_key_fingerprint: string | null;
  ssh_public_key: string | null;
  sudo_commands: string[];
  created_at: string;
  updated_at: string;
}

export interface InfraNetwork {
  id: string;
  name: string;
  vlan_tag: number | null;
  subnet: string;
  gateway: string;
  location: string;
}

export interface InfraNode {
  id: string;
  name: string;
  node_type: string;
  location: string;
  parent_id: string | null;
  network_id: string | null;
  ip_local: string;
  ip_tailscale: string;
  role: string;
  status: string;
  source_files: string[];
}

export interface InfraService {
  id: string;
  name: string;
  node_id: string | null;
  category: string;
  description: string;
  domain: string;
  source_files: string[];
}

export interface InfraLink {
  id: string;
  source_node_id: string;
  target_node_id: string;
  kind: string;
  label: string;
}

export interface InfraMap {
  networks: InfraNetwork[];
  nodes: InfraNode[];
  services: InfraService[];
  links: InfraLink[];
  last_refresh: { run_id: string; status: string; finished_at: string | null } | null;
}

export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  knowledge_path: string;
  instructions: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeFile {
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
}

export interface SearchMatch {
  line_number: number;
  line: string;
  context_before: string[];
  context_after: string[];
}

export interface SearchResult {
  file: string;
  score: number;
  matches: SearchMatch[];
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

export type HarnessComponentType = "claude_md" | "rule" | "agent" | "skill" | "context" | "script";

export interface HarnessComponentSummary {
  name: string;
  description: string | null;
  modified_at: number;
}

export interface HarnessComponentDetail {
  component_type: HarnessComponentType;
  name: string;
  content: string;
  metadata: Record<string, unknown>;
  modified_at: number;
}

export interface HarnessListResponse {
  claude_md: HarnessComponentSummary[];
  rule: HarnessComponentSummary[];
  agent: HarnessComponentSummary[];
  skill: HarnessComponentSummary[];
  context: HarnessComponentSummary[];
  script: HarnessComponentSummary[];
}

export const api = {
  agents: {
    list: () => apiFetch<Agent[]>("/api/agents"),
    get: (id: string) => apiFetch<Agent>(`/api/agents/${id}`),
    generate: (description: string) =>
      apiFetch<AgentGenerated>("/api/agents/generate", { method: "POST", body: JSON.stringify({ description }) }),
    create: (data: Partial<Agent>) =>
      apiFetch<Agent>("/api/agents", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Agent>) =>
      apiFetch<Agent>(`/api/agents/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      apiFetch<void>(`/api/agents/${id}`, { method: "DELETE" }),
    previewPrompt: (id: string) =>
      apiFetch<{ system_prompt: string }>(`/api/agents/${id}/preview-prompt`),
    previewFullPrompt: (id: string, inputParams: Record<string, unknown>) =>
      apiFetch<{ system_prompt: string; user_message: string }>(`/api/agents/${id}/preview-prompt`, {
        method: "POST",
        body: JSON.stringify({ input_params: inputParams }),
      }),
  },
  runs: {
    list: (params?: { agent_id?: string; statuses?: string[]; limit?: number; offset?: number; original_run_id?: string; conversation_id?: string; top_level?: boolean }) => {
      const p = new URLSearchParams();
      if (params?.agent_id) p.set("agent_id", params.agent_id);
      if (params?.limit !== undefined) p.set("limit", String(params.limit));
      if (params?.offset !== undefined) p.set("offset", String(params.offset));
      if (params?.original_run_id) p.set("original_run_id", params.original_run_id);
      if (params?.conversation_id) p.set("conversation_id", params.conversation_id);
      if (params?.top_level) p.set("top_level", "true");
      for (const s of params?.statuses ?? []) p.append("status", s);
      const qs = p.toString();
      return apiFetch<Run[]>(`/api/runs${qs ? `?${qs}` : ""}`);
    },
    knowledgeConversations: (params?: { limit?: number; offset?: number }) => {
      const p = new URLSearchParams();
      if (params?.limit !== undefined) p.set("limit", String(params.limit));
      if (params?.offset !== undefined) p.set("offset", String(params.offset));
      const qs = p.toString();
      return apiFetch<KnowledgeConversation[]>(`/api/runs/knowledge-conversations${qs ? `?${qs}` : ""}`);
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
  infraTargets: {
    list: () => apiFetch<InfraTarget[]>("/api/infra-targets"),
    get: (id: string) => apiFetch<InfraTarget>(`/api/infra-targets/${id}`),
    create: (data: Partial<InfraTarget>) =>
      apiFetch<InfraTarget>("/api/infra-targets", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<InfraTarget>) =>
      apiFetch<InfraTarget>(`/api/infra-targets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      apiFetch<void>(`/api/infra-targets/${id}`, { method: "DELETE" }),
    verifyHost: (id: string) =>
      apiFetch<InfraTarget>(`/api/infra-targets/${id}/verify-host`, { method: "POST" }),
    regenerateKey: (id: string) =>
      apiFetch<InfraTarget>(`/api/infra-targets/${id}/regenerate-key`, { method: "POST" }),
    setupCommands: (id: string) =>
      apiFetch<{ commands: string }>(`/api/infra-targets/${id}/setup-commands`),
  },
  infraMap: {
    get: () => apiFetch<InfraMap>("/api/infra-map"),
    refresh: () =>
      apiFetch<{ run_id: string; status: string }>("/api/infra-map/refresh", { method: "POST" }),
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
  harness: {
    list: () => apiFetch<HarnessListResponse>("/api/harness"),
    get: (type: HarnessComponentType, name: string) =>
      apiFetch<HarnessComponentDetail>(`/api/harness/${type}/${name}`),
    create: (type: HarnessComponentType, name: string, content: string) =>
      apiFetch<HarnessComponentDetail>(`/api/harness/${type}`, {
        method: "POST",
        body: JSON.stringify({ name, content }),
      }),
    update: (type: HarnessComponentType, name: string, content: string) =>
      apiFetch<HarnessComponentDetail>(`/api/harness/${type}/${name}`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    delete: (type: HarnessComponentType, name: string) =>
      apiFetch<void>(`/api/harness/${type}/${name}`, { method: "DELETE" }),
    generate: (type: HarnessComponentType, description: string) =>
      apiFetch<{ content: string }>("/api/harness/generate", {
        method: "POST",
        body: JSON.stringify({ component_type: type, description }),
      }),
  },
  execute: (req: ExecuteRequest) =>
    apiFetch<ExecuteResponse | ExecuteAsyncResponse>("/api/execute", {
      method: "POST",
      body: JSON.stringify(req),
    }),
    knowledgeBases: {
    list: () => apiFetch<KnowledgeBase[]>("/api/knowledge-bases"),
    get: (id: string) => apiFetch<KnowledgeBase>(`/api/knowledge-bases/${id}`),
    create: (data: Partial<KnowledgeBase>) =>
      apiFetch<KnowledgeBase>("/api/knowledge-bases", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Partial<KnowledgeBase>) =>
      apiFetch<KnowledgeBase>(`/api/knowledge-bases/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    delete: (id: string) =>
      apiFetch<void>(`/api/knowledge-bases/${id}`, { method: "DELETE" }),
    files: {
      list: (id: string) =>
        apiFetch<KnowledgeFile[]>(`/api/knowledge-bases/${id}/files`),
      get: (id: string, path: string) =>
        fetch(`${BASE_URL}/api/knowledge-bases/${id}/files/${path}`, { credentials: "include" })
          .then((r) => { if (!r.ok) throw new Error(`API error ${r.status}`); return r.text(); }),
      update: (id: string, path: string, content: string) =>
        apiFetch<KnowledgeFile>(`/api/knowledge-bases/${id}/files/${path}`, {
          method: "PUT",
          body: content,
          headers: { "Content-Type": "text/plain" },
        }),
      delete: (id: string, path: string) =>
        apiFetch<void>(`/api/knowledge-bases/${id}/files/${path}`, { method: "DELETE" }),
      upload: async (id: string, files: File[]): Promise<{ written: string[]; errors: string[] }> => {
        const formData = new FormData();
        const paths = files.map(
          (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
        );
        const roots = new Set(paths.map((p) => p.split("/")[0]));
        const stripRoot = roots.size === 1 && paths.some((p) => p.includes("/"));
        for (let i = 0; i < files.length; i++) {
          const path = stripRoot ? paths[i].split("/").slice(1).join("/") : paths[i];
          formData.append("files", files[i], path || files[i].name);
        }
        const res = await fetch(`${BASE_URL}/api/knowledge-bases/${id}/upload`, {
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
      apiFetch<{ run_id: string }>(`/api/knowledge-bases/${id}/query`, {
        method: "POST",
        body: JSON.stringify({
          user_message: userMessage,
          ...(resumeSessionId ? { resume_session_id: resumeSessionId } : {}),
          ...(conversationId ? { conversation_id: conversationId } : {}),
          ...(tools ? { tools } : {}),
        }),
      }),
    search: (id: string, q: string) =>
      apiFetch<SearchResult[]>(`/api/knowledge-bases/${id}/search?${new URLSearchParams({ q })}`),
    previewPrompt: (id: string, mode: "chat" | "context" = "chat") =>
      apiFetch<{ system_prompt: string }>(
        `/api/knowledge-bases/${id}/preview-prompt?${new URLSearchParams({ mode })}`,
      ),
  },
};
