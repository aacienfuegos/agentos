"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Run, Agent } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-900 text-blue-300 animate-pulse",
  success: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
  cancelled: "bg-zinc-700 text-zinc-400",
};

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function dur(run: Run): string {
  if (!run.started_at || !run.finished_at) return "—";
  const s = Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

export default function RunsList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    Promise.all([api.runs.list({ limit: 100 }), api.agents.list()]).then(([r, a]) => {
      setRuns(r);
      setAgents(a);
    });
  }, []);

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));
  const filtered = statusFilter ? runs.filter((r) => r.status === statusFilter) : runs;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Ejecuciones</h1>
        <select
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 focus:outline-none"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">Todos los estados</option>
          <option value="running">running</option>
          <option value="success">success</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Agente</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Inicio</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Duración</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Coste</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Origen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((run) => (
              <tr key={run.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/runs/${run.id}`} className="text-zinc-200 hover:text-violet-400 transition-colors">
                    {agentMap[run.agent_id]?.name ?? run.agent_id}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[run.status]}`}>
                    {run.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{fmt(run.started_at ?? run.created_at)}</td>
                <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{dur(run)}</td>
                <td className="px-4 py-3 text-zinc-500 font-mono text-xs">
                  {run.cost_usd !== null ? `$${run.cost_usd.toFixed(4)}` : "—"}
                </td>
                <td className="px-4 py-3 text-zinc-600 text-xs">{run.triggered_by}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">Sin ejecuciones</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
