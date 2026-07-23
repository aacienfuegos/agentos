"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Agent, KnowledgeBase } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const AGENT_PARAMS: Record<string, Array<{ key: string; label: string; placeholder: string; required?: boolean }>> = {
  "code-review": [
    { key: "repo", label: "Repositorio", placeholder: "usuario/repo", required: true },
    { key: "pr_number", label: "PR número (opcional)", placeholder: "42" },
    { key: "focus", label: "Foco", placeholder: "all | security | performance | style" },
  ],
  "portfolio-updater": [
    { key: "github_username", label: "GitHub username", placeholder: "tuusuario", required: true },
    { key: "portfolio_repo", label: "Repo del portfolio", placeholder: "usuario/portfolio", required: true },
    { key: "content_path", label: "Ruta del fichero de proyectos", placeholder: "src/data/projects.json" },
  ],
  "vuln-scan": [
    { key: "repo", label: "Repositorio", placeholder: "usuario/repo", required: true },
    { key: "scan_type", label: "Tipo de scan", placeholder: "all | dependencies | code | secrets" },
  ],
  custom: [
    { key: "user_message", label: "Tarea", placeholder: "Describe lo que quieres que haga el agente...", required: true },
  ],
};

type AgentForm = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  tools: string;
  timeout_seconds: string;
  max_tokens: string;
  knowledge_base_id: string;
};

const DEFAULT_FORM: AgentForm = {
  id: "", name: "", description: "", system_prompt: "",
  model: "claude-sonnet-4-6", tools: "", timeout_seconds: "300",
  max_tokens: "8192", knowledge_base_id: "",
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);

  const [creating, setCreating] = useState(false);
  const [createTab, setCreateTab] = useState<"manual" | "ai">("manual");
  const [aiDescription, setAiDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<AgentForm>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState<AgentForm>(DEFAULT_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = () =>
    Promise.all([api.agents.list().then(setAgents), api.knowledgeBases.list().then(setKnowledgeBases)]);

  useEffect(() => { load(); }, []);

  const openAgent = (agent: Agent) => { setSelected(agent); setParams({}); };

  const openCreate = () => {
    setForm(DEFAULT_FORM);
    setAiDescription("");
    setCreateTab("manual");
    setCreating(true);
  };

  const generateWithAI = async () => {
    if (!aiDescription.trim()) return;
    setGenerating(true);
    try {
      const result = await api.agents.generate(aiDescription);
      setForm({
        id: result.id,
        name: result.name,
        description: result.description,
        system_prompt: result.system_prompt,
        model: result.model,
        tools: result.tools.join(", "),
        timeout_seconds: "300",
        max_tokens: "8192",
        knowledge_base_id: result.knowledge_base_id ?? "",
      });
      setCreateTab("manual");
    } catch (e) {
      alert(`Error generando: ${e}`);
    } finally {
      setGenerating(false);
    }
  };

  const saveCreate = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.agents.create({
        id: form.id,
        name: form.name,
        description: form.description,
        system_prompt: form.system_prompt,
        model: form.model,
        tools: form.tools.split(",").map((t) => t.trim()).filter(Boolean),
        timeout_seconds: parseInt(form.timeout_seconds) || 300,
        max_tokens: parseInt(form.max_tokens) || 8192,
        knowledge_base_id: form.knowledge_base_id || null,
      });
      setCreating(false);
      await load();
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (agent: Agent) => {
    setEditForm({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      system_prompt: agent.system_prompt,
      model: agent.model,
      tools: agent.tools.join(", "),
      timeout_seconds: String(agent.timeout_seconds),
      max_tokens: String(agent.max_tokens),
      knowledge_base_id: agent.knowledge_base_id ?? "",
    });
    setEditing(agent);
  };

  const saveEdit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editing) return;
    setEditSaving(true);
    try {
      await api.agents.update(editing.id, {
        name: editForm.name,
        description: editForm.description,
        system_prompt: editForm.system_prompt,
        model: editForm.model,
        tools: editForm.tools.split(",").map((t) => t.trim()).filter(Boolean),
        timeout_seconds: parseInt(editForm.timeout_seconds) || editing.timeout_seconds,
        max_tokens: parseInt(editForm.max_tokens) || editing.max_tokens,
        knowledge_base_id: editForm.knowledge_base_id || null,
      });
      setEditing(null);
      await load();
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setEditSaving(false);
    }
  };

  const deleteAgent = async () => {
    if (!editing) return;
    if (!confirm(`¿Eliminar "${editing.name}"? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    try {
      await api.agents.delete(editing.id);
      setEditing(null);
      await load();
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setDeleting(false);
    }
  };

  const launch = async () => {
    if (!selected) return;
    setLaunching(true);
    try {
      const input: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v.trim()) {
          input[k] = k === "pr_number" ? parseInt(v) || v : v;
        }
      }
      const run = await api.runs.create(selected.id, input);
      router.push(`/runs/${run.id}`);
    } catch (e) {
      alert(`Error: ${e}`);
      setLaunching(false);
    }
  };

  const kaName = (id: string | null) => knowledgeBases.find((k) => k.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Biblioteca de agentes</h1>
        <Button className="bg-violet-600 hover:bg-violet-700 text-white" size="sm" onClick={openCreate}>
          + Nuevo agente
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <Card key={agent.id} className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base font-medium text-zinc-100">{agent.name}</CardTitle>
                {agent.is_builtin && (
                  <span className="text-xs px-1.5 py-0.5 bg-violet-900 text-violet-300 rounded">built-in</span>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-zinc-400 leading-relaxed">{agent.description}</p>
              <div className="flex gap-2 flex-wrap">
                <span className="text-xs px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded font-mono">
                  {agent.model.split("-").slice(-2).join("-")}
                </span>
                <span className="text-xs px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded">
                  {agent.tools.length} tools
                </span>
                <span className="text-xs px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded">
                  {agent.timeout_seconds}s
                </span>
                {agent.knowledge_base_id && (
                  <span className="text-xs px-1.5 py-0.5 bg-emerald-900/50 text-emerald-400 rounded">
                    kb: {kaName(agent.knowledge_base_id)}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                  size="sm"
                  onClick={() => openAgent(agent)}
                >
                  Lanzar
                </Button>
                {!agent.is_builtin && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    onClick={() => openEdit(agent)}
                  >
                    Editar
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Launch dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Lanzar: {selected?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {(AGENT_PARAMS[selected?.id ?? ""] ?? AGENT_PARAMS["custom"]).map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">{field.label}</Label>
                <Textarea
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600 resize-none"
                  placeholder={field.placeholder}
                  rows={field.key === "user_message" ? 5 : 1}
                  value={params[field.key] ?? ""}
                  onChange={(e) => setParams((p) => ({ ...p, [field.key]: e.target.value }))}
                />
              </div>
            ))}
            <Button className="w-full bg-violet-600 hover:bg-violet-700" onClick={launch} disabled={launching}>
              {launching ? "Lanzando…" : "Ejecutar agente"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo agente</DialogTitle>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-zinc-800 mb-2">
            {(["manual", "ai"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setCreateTab(tab)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  createTab === tab
                    ? "text-violet-400 border-b-2 border-violet-500"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tab === "manual" ? "Manual" : "Generar con IA"}
              </button>
            ))}
          </div>

          {createTab === "ai" ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Describe qué hace este agente</Label>
                <Textarea
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  placeholder="Ej: Un agente que monitoriza mis repositorios de GitHub, revisa PRs abiertas y envía un resumen diario con lo más urgente."
                  rows={5}
                  className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600 resize-none"
                />
              </div>
              <Button
                className="w-full bg-violet-600 hover:bg-violet-700"
                onClick={generateWithAI}
                disabled={generating || !aiDescription.trim()}
              >
                {generating ? "Generando…" : "Generar definición"}
              </Button>
              {generating && (
                <p className="text-xs text-zinc-500 text-center">
                  Claude está diseñando el agente, puede tardar unos segundos…
                </p>
              )}
            </div>
          ) : (
            <AgentFormFields form={form} setForm={setForm} knowledgeBases={knowledgeBases} />
          )}

          {createTab === "manual" && (
            <form onSubmit={saveCreate}>
              <Button type="submit" disabled={saving} className="w-full bg-violet-600 hover:bg-violet-700 mt-2">
                {saving ? "Creando…" : "Crear agente"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar: {editing?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4 pt-2">
            <AgentFormFields form={editForm} setForm={setEditForm} knowledgeBases={knowledgeBases} showId={false} />
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={deleteAgent}
                disabled={deleting}
                className="text-xs text-red-500/60 hover:text-red-400 transition-colors disabled:opacity-30"
              >
                {deleting ? "eliminando…" : "eliminar agente"}
              </button>
              <Button type="submit" disabled={editSaving} className="bg-violet-600 hover:bg-violet-700">
                {editSaving ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentFormFields({
  form,
  setForm,
  knowledgeBases,
  showId = true,
}: {
  form: AgentForm;
  setForm: React.Dispatch<React.SetStateAction<AgentForm>>;
  knowledgeBases: KnowledgeBase[];
  showId?: boolean;
}) {
  const set = (key: keyof AgentForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const inputCls = "w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500";
  const selectCls = `${inputCls} text-zinc-300`;

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${showId ? "grid-cols-2" : "grid-cols-2"}`}>
        {showId && (
          <div className="space-y-1.5">
            <Label className="text-zinc-400 text-xs">ID (slug)</Label>
            <input value={form.id} onChange={set("id")} required placeholder="mi-agente" className={inputCls} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs">Nombre</Label>
          <input value={form.name} onChange={set("name")} required className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs">Modelo</Label>
          <select value={form.model} onChange={set("model")} className={selectCls}>
            {[
              { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
              { value: "claude-opus-4-8", label: "Opus 4.8" },
              { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
            ].map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-zinc-400 text-xs">Descripción</Label>
        <input value={form.description} onChange={set("description")} className={inputCls} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-zinc-400 text-xs">System prompt</Label>
        <Textarea
          value={form.system_prompt}
          onChange={set("system_prompt")}
          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600 font-mono text-xs resize-y min-h-32 max-h-64 overflow-y-auto"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-zinc-400 text-xs">Tools</Label>
        <ToolSelector
          value={form.tools}
          onChange={(v) => setForm((f) => ({ ...f, tools: v }))}
        />
      </div>
      {knowledgeBases.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs">Base de conocimiento (opcional)</Label>
          <select value={form.knowledge_base_id} onChange={set("knowledge_base_id")} className={selectCls}>
            <option value="">Sin base de conocimiento</option>
            {knowledgeBases.map((kb) => (
              <option key={kb.id} value={kb.id}>{kb.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs">Timeout (s)</Label>
          <input type="number" value={form.timeout_seconds} onChange={set("timeout_seconds")} className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-zinc-400 text-xs">Max tokens</Label>
          <input type="number" value={form.max_tokens} onChange={set("max_tokens")} className={inputCls} />
        </div>
      </div>
    </div>
  );
}

const ALL_TOOLS = [
  "Read", "Write", "Edit", "Bash", "Grep", "LS",
  "WebFetch", "WebSearch", "TodoRead", "TodoWrite",
];

function ToolSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = new Set(value.split(",").map((t) => t.trim()).filter(Boolean));

  const toggle = (tool: string) => {
    const next = new Set(selected);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    onChange(ALL_TOOLS.filter((t) => next.has(t)).join(", "));
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_TOOLS.map((tool) => {
        const active = selected.has(tool);
        return (
          <button
            key={tool}
            type="button"
            onClick={() => toggle(tool)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              active
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            {tool}
          </button>
        );
      })}
    </div>
  );
}
