"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Run, Agent, Stats, HealthStatus } from "@/lib/api";
import { fmtTokens } from "@/lib/utils";

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

const STATUS_DOT: Record<string, string> = {
  pending:   "bg-zinc-500",
  running:   "bg-sky-400 animate-pulse",
  success:   "bg-emerald-500",
  failed:    "bg-red-500",
  cancelled: "bg-zinc-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending:   "pendiente",
  running:   "activo",
  success:   "ok",
  failed:    "error",
  cancelled: "cancelado",
};

const STATUS_TEXT: Record<string, string> = {
  pending:   "text-zinc-500",
  running:   "text-sky-400",
  success:   "text-emerald-400",
  failed:    "text-red-400",
  cancelled: "text-zinc-600",
};

function StatusDot({ status }: { status: Run["status"] }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
      <span className={`text-xs font-mono ${STATUS_TEXT[status]}`}>{STATUS_LABEL[status] ?? status}</span>
    </span>
  );
}

function RunRow({ run, agents }: { run: Run; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === run.agent_id);
  const duration =
    run.started_at && run.finished_at
      ? `${Math.round((asUTC(run.finished_at).getTime() - asUTC(run.started_at).getTime()) / 1000)}s`
      : run.started_at ? "en curso…" : "—";

  return (
    <Link
      href={`/runs/${run.id}`}
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors group"
    >
      <StatusDot status={run.status} />
      <span className="flex-1 text-sm text-zinc-300 truncate group-hover:text-zinc-100 transition-colors">
        {agent?.name ?? run.agent_id}
      </span>
      <span className="text-xs font-mono text-zinc-600">{duration}</span>
    </Link>
  );
}

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
        <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500">{title}</span>
        {action}
      </div>
      <div className="p-2">{children}</div>
    </div>
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
      setHealth({ status: "degraded", version: "?", services: { redis: false, database: false, claude: false } });
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
    <div className="space-y-6">
      {/* Claude auth warning */}
      {health && health.services.claude === false && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.04] text-sm">
          <span className="text-amber-400 font-mono shrink-0 mt-0.5">⚠</span>
          <div className="space-y-1">
            <p className="text-amber-300 font-medium">Claude no autenticado</p>
            <p className="text-zinc-400 text-xs">Los agentes fallarán hasta que hagas login. Ejecuta en el servidor:</p>
            <code className="block text-xs font-mono text-amber-400/80 bg-black/30 px-2 py-1 rounded mt-1">
              docker compose exec -it worker claude /login
            </code>
          </div>
        </div>
      )}

      {/* Top stats strip */}
      {(stats || health) && (
        <div className="flex items-center gap-6 text-xs font-mono text-zinc-600">
          {stats && (
            <>
              <span><span className="text-zinc-400">{stats.runs_this_month}</span> este mes</span>
              <span className="text-zinc-800">·</span>
              <span><span className="text-zinc-400">{stats.runs_today}</span> hoy</span>
              {stats.tokens_this_month.total > 0 && (
                <>
                  <span className="text-zinc-800">·</span>
                  <span><span className="text-zinc-400">{fmtTokens(stats.tokens_this_month.total)}</span> tokens este mes</span>
                </>
              )}
            </>
          )}
          {health && (
            <>
              <span className="text-zinc-800">·</span>
              <span className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${health.status === "ok" ? "bg-emerald-500" : "bg-red-500"}`} />
                {Object.entries(health.services).map(([svc, ok]) => (
                  <span key={svc} className={ok ? "text-zinc-500" : "text-red-500"}>{svc}</span>
                )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="text-zinc-800">·</span>, el], [] as React.ReactNode[])}
              </span>
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column */}
        <div className="space-y-4">
          <Panel
            title="Activas"
            action={activeRuns.length > 0 ? (
              <span className="font-mono text-[11px] text-amber-400">{activeRuns.length}</span>
            ) : undefined}
          >
            {activeRuns.length === 0 ? (
              <p className="px-3 py-3 text-xs font-mono text-zinc-700">— sin actividad —</p>
            ) : (
              <div className="space-y-0.5">
                {activeRuns.map((r) => <RunRow key={r.id} run={r} agents={agents} />)}
              </div>
            )}
          </Panel>

          <Panel
            title="Recientes"
            action={
              <Link href="/runs" className="text-[11px] font-mono text-amber-400/60 hover:text-amber-400 transition-colors">
                ver todo →
              </Link>
            }
          >
            {recentRuns.length === 0 ? (
              <p className="px-3 py-3 text-xs font-mono text-zinc-700">— sin ejecuciones —</p>
            ) : (
              <div className="space-y-0.5">
                {recentRuns.map((r) => <RunRow key={r.id} run={r} agents={agents} />)}
              </div>
            )}
          </Panel>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <Panel
            title="Lanzar"
            action={
              <Link href="/agents" className="text-[11px] font-mono text-amber-400/60 hover:text-amber-400 transition-colors">
                biblioteca →
              </Link>
            }
          >
            <div className="space-y-0.5">
              {builtinAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => launchAgent(agent.id)}
                  disabled={launching === agent.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/[0.04] transition-all text-left disabled:opacity-40 group"
                >
                  <span className="text-amber-400/40 font-mono text-xs group-hover:text-amber-400/80 transition-colors">▶</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-300 group-hover:text-zinc-100 transition-colors">{agent.name}</p>
                    <p className="text-xs text-zinc-600 truncate">{agent.description}</p>
                  </div>
                  {launching === agent.id && (
                    <span className="text-[11px] font-mono text-amber-400 animate-pulse">···</span>
                  )}
                </button>
              ))}

              <div className="pt-1">
                {!showCustom ? (
                  <button
                    onClick={() => setShowCustom(true)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-dashed border-white/[0.06] hover:border-amber-400/25 text-zinc-600 hover:text-amber-400/80 transition-all text-sm"
                  >
                    <span className="font-mono text-xs">+</span>
                    tarea personalizada
                  </button>
                ) : (
                  <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.02] p-3 space-y-2">
                    <textarea
                      className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-700 resize-none focus:outline-none font-mono leading-relaxed"
                      rows={4}
                      placeholder="// describe la tarea..."
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      autoFocus
                    />
                    <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
                      <button
                        onClick={() => { setShowCustom(false); setCustomPrompt(""); }}
                        className="text-xs font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        cancelar
                      </button>
                      <button
                        onClick={() => launchAgent("custom", { user_message: customPrompt })}
                        disabled={!customPrompt.trim() || launching === "custom"}
                        className="text-xs font-mono text-amber-400 hover:text-amber-300 px-3 py-1 border border-amber-400/20 hover:border-amber-400/40 rounded transition-all disabled:opacity-40"
                      >
                        {launching === "custom" ? "lanzando···" : "ejecutar →"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Panel
            title="Agentes"
            action={
              <span className="font-mono text-[11px] text-zinc-600">{agents.length} disponibles</span>
            }
          >
            <div className="space-y-0.5">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60 shrink-0" />
                  <span className="flex-1 text-sm text-zinc-400">{agent.name}</span>
                  <span className="text-[11px] font-mono text-zinc-700">
                    {agent.model.split("-").slice(-2).join("-")}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
