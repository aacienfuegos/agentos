"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Run, Agent, Stats, HealthStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-900 text-blue-300 animate-pulse",
  success: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
  cancelled: "bg-zinc-700 text-zinc-400",
};

function StatusBadge({ status }: { status: Run["status"] }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[status]}`}>
      {status}
    </span>
  );
}

function RunRow({ run, agents }: { run: Run; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === run.agent_id);
  const duration =
    run.started_at && run.finished_at
      ? `${Math.round((asUTC(run.finished_at).getTime() - asUTC(run.started_at).getTime()) / 1000)}s`
      : run.started_at
      ? "en curso…"
      : "—";

  return (
    <Link href={`/runs/${run.id}`} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-zinc-800 transition-colors">
      <StatusBadge status={run.status} />
      <span className="flex-1 text-sm text-zinc-200 truncate">{agent?.name ?? run.agent_id}</span>
      <span className="text-xs text-zinc-500 font-mono">{duration}</span>
    </Link>
  );
}

export default function Dashboard() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const fetchData = async () => {
    const [r, a, s] = await Promise.all([api.runs.list({ limit: 20 }), api.agents.list(), api.stats()]);
    setRuns(r);
    setAgents(a);
    setStats(s);
  };

  const fetchHealth = async () => {
    try {
      setHealth(await api.health());
    } catch {
      setHealth({ status: "degraded", version: "?", services: { redis: false, database: false } });
    }
  };

  useEffect(() => {
    fetchData();
    fetchHealth();
    const interval = setInterval(fetchData, 5000);
    const healthInterval = setInterval(fetchHealth, 30000);
    return () => { clearInterval(interval); clearInterval(healthInterval); };
  }, []);

  const launchAgent = async (agentId: string, params: Record<string, unknown> = {}) => {
    setLaunching(agentId);
    try {
      const run = await api.runs.create(agentId, params);
      window.location.href = `/runs/${run.id}`;
    } catch (e) {
      alert(`Error: ${e}`);
      setLaunching(null);
    }
  };

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending");
  const recentRuns = runs.filter((r) => r.status !== "running" && r.status !== "pending").slice(0, 5);
  const builtinAgents = agents.filter((a) => a.is_builtin && a.id !== "custom");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left column */}
      <div className="space-y-6">
        {/* Active runs */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-400">Ejecuciones activas</CardTitle>
          </CardHeader>
          <CardContent>
            {activeRuns.length === 0 ? (
              <p className="text-sm text-zinc-600 py-2">Sin ejecuciones activas</p>
            ) : (
              <div className="space-y-1">
                {activeRuns.map((r) => <RunRow key={r.id} run={r} agents={agents} />)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent runs */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-zinc-400">Últimas ejecuciones</CardTitle>
              <Link href="/runs" className="text-xs text-violet-400 hover:text-violet-300">Ver todo →</Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-sm text-zinc-600 py-2">Sin ejecuciones completadas</p>
            ) : (
              <div className="space-y-1">
                {recentRuns.map((r) => <RunRow key={r.id} run={r} agents={agents} />)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        {stats && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-zinc-400">Este mes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-center mb-4">
                <div>
                  <p className="text-2xl font-bold text-zinc-100">{stats.runs_this_month}</p>
                  <p className="text-xs text-zinc-500">ejecuciones</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-zinc-100">{stats.runs_today}</p>
                  <p className="text-xs text-zinc-500">hoy</p>
                </div>
              </div>
              {Object.keys(stats.runs_by_agent_this_month).length > 0 && (
                <div className="space-y-1">
                  {Object.entries(stats.runs_by_agent_this_month).map(([agentId, count]) => (
                    <div key={agentId} className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400 truncate">{agentId}</span>
                      <span className="text-zinc-300 font-mono ml-2">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Health */}
        {health && (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${health.status === "ok" ? "bg-green-500" : "bg-red-500"}`} />
                <CardTitle className="text-sm font-medium text-zinc-400">
                  Servicios — {health.status === "ok" ? "operativos" : "degradados"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 text-xs">
                {Object.entries(health.services).map(([svc, ok]) => (
                  <div key={svc} className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="text-zinc-400">{svc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right column */}
      <div className="space-y-6">
        {/* Quick launch */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-zinc-400">Lanzar agente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {builtinAgents.map((agent) => (
              <Button
                key={agent.id}
                variant="outline"
                className="w-full justify-start text-left border-zinc-700 hover:bg-zinc-800 hover:border-zinc-600"
                onClick={() => launchAgent(agent.id)}
                disabled={launching === agent.id}
              >
                <span className="font-medium">{agent.name}</span>
                <span className="ml-2 text-zinc-500 text-xs truncate">{agent.description}</span>
              </Button>
            ))}
            <Button
              variant="outline"
              className="w-full border-violet-800 text-violet-400 hover:bg-violet-950 hover:border-violet-600"
              onClick={() => setShowCustom(!showCustom)}
            >
              + Nueva tarea personalizada
            </Button>
            {showCustom && (
              <div className="space-y-2 pt-1">
                <textarea
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:ring-1 focus:ring-violet-500"
                  rows={4}
                  placeholder="Describe la tarea que quieres que ejecute el agente..."
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                />
                <Button
                  className="w-full bg-violet-600 hover:bg-violet-700"
                  onClick={() => launchAgent("custom", { user_message: customPrompt })}
                  disabled={!customPrompt.trim() || launching === "custom"}
                >
                  {launching === "custom" ? "Lanzando…" : "Ejecutar"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick stats */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-zinc-400">Agentes disponibles</CardTitle>
              <Link href="/agents" className="text-xs text-violet-400 hover:text-violet-300">Ver biblioteca →</Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {agents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-3 py-1">
                <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                <span className="text-sm text-zinc-200">{agent.name}</span>
                <span className="ml-auto text-xs text-zinc-600">{agent.model.split("-").slice(-2).join("-")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
