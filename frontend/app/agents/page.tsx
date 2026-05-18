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

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    api.agents.list().then(setAgents);
  }, []);

  const openAgent = (agent: Agent) => {
    setSelected(agent);
    setParams({});
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
              <Button
                className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                size="sm"
                onClick={() => openAgent(agent)}
              >
                Lanzar
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

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
    </div>
  );
}
