"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Agent } from "@/lib/api";
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

const MODELS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-7", label: "Opus 4.7" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

type EditForm = {
  name: string;
  description: string;
  system_prompt: string;
  model: string;
  tools: string;
  timeout_seconds: string;
  max_tokens: string;
};

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    name: "", description: "", system_prompt: "", model: "", tools: "", timeout_seconds: "", max_tokens: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = () => api.agents.list().then(setAgents);

  useEffect(() => { load(); }, []);

  const openAgent = (agent: Agent) => {
    setSelected(agent);
    setParams({});
  };

  const openEdit = (agent: Agent) => {
    setEditForm({
      name: agent.name,
      description: agent.description,
      system_prompt: agent.system_prompt,
      model: agent.model,
      tools: agent.tools.join(", "),
      timeout_seconds: String(agent.timeout_seconds),
      max_tokens: String(agent.max_tokens),
    });
    setEditing(agent);
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

  const saveEdit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      await api.agents.update(editing.id, {
        name: editForm.name,
        description: editForm.description,
        system_prompt: editForm.system_prompt,
        model: editForm.model,
        tools: editForm.tools.split(",").map((t) => t.trim()).filter(Boolean),
        timeout_seconds: parseInt(editForm.timeout_seconds) || editing.timeout_seconds,
        max_tokens: parseInt(editForm.max_tokens) || editing.max_tokens,
      });
      setEditing(null);
      await load();
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setSaving(false);
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

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-zinc-100">Biblioteca de agentes</h1>

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
                  {agent.timeout_seconds}s timeout
                </span>
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
            <Button
              className="w-full bg-violet-600 hover:bg-violet-700"
              onClick={launch}
              disabled={launching}
            >
              {launching ? "Lanzando…" : "Ejecutar agente"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar: {editing?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Nombre</Label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Modelo</Label>
                <select
                  value={editForm.model}
                  onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-violet-500"
                >
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Descripción</Label>
              <input
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">System prompt</Label>
              <Textarea
                value={editForm.system_prompt}
                onChange={(e) => setEditForm((f) => ({ ...f, system_prompt: e.target.value }))}
                rows={5}
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600 resize-none font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Tools (separadas por coma)</Label>
              <input
                value={editForm.tools}
                onChange={(e) => setEditForm((f) => ({ ...f, tools: e.target.value }))}
                placeholder="Bash, Read, Write, WebFetch"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Timeout (segundos)</Label>
                <input
                  type="number"
                  value={editForm.timeout_seconds}
                  onChange={(e) => setEditForm((f) => ({ ...f, timeout_seconds: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Max tokens</Label>
                <input
                  type="number"
                  value={editForm.max_tokens}
                  onChange={(e) => setEditForm((f) => ({ ...f, max_tokens: e.target.value }))}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={deleteAgent}
                disabled={deleting}
                className="text-xs text-red-500/60 hover:text-red-400 transition-colors disabled:opacity-30"
              >
                {deleting ? "eliminando…" : "eliminar agente"}
              </button>
              <Button
                type="submit"
                disabled={saving}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {saving ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
