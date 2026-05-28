"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Run, Agent } from "@/lib/api";

const STATUS_DOT: Record<string, string> = {
  pending:   "bg-zinc-500",
  running:   "bg-sky-400 animate-pulse",
  success:   "bg-emerald-500",
  failed:    "bg-red-500",
  cancelled: "bg-zinc-700",
};

const STATUS_TEXT: Record<string, string> = {
  pending:   "text-zinc-500",
  running:   "text-sky-400",
  success:   "text-emerald-400",
  failed:    "text-red-400",
  cancelled: "text-zinc-600",
};

const STATUS_LABEL: Record<string, string> = {
  pending:   "pendiente",
  running:   "activo",
  success:   "ok",
  failed:    "error",
  cancelled: "cancelado",
};

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return asUTC(dt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function dur(run: Run): string {
  if (!run.started_at || !run.finished_at) return "—";
  const s = Math.round((asUTC(run.finished_at).getTime() - asUTC(run.started_at).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

const STATUSES = ["running", "success", "failed", "cancelled"];

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
        <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight">Ejecuciones</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStatusFilter("")}
            className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
              statusFilter === "" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            todas
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s === statusFilter ? "" : s)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                statusFilter === s ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} />
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.04]">
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600">Agente</th>
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600">Estado</th>
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600 hidden sm:table-cell">Inicio</th>
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600">Dur.</th>
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600 hidden md:table-cell">Coste</th>
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600 hidden lg:table-cell">Origen</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((run, i) => (
              <tr
                key={run.id}
                className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors ${
                  i === filtered.length - 1 ? "border-b-0" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/runs/${run.id}`}
                    className="text-zinc-300 hover:text-amber-400 transition-colors font-medium"
                  >
                    {agentMap[run.agent_id]?.name ?? run.agent_id}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[run.status]}`} />
                    <span className={`text-xs font-mono ${STATUS_TEXT[run.status]}`}>
                      {STATUS_LABEL[run.status] ?? run.status}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-600 font-mono text-xs hidden sm:table-cell">
                  {fmt(run.started_at ?? run.created_at)}
                </td>
                <td className="px-4 py-3 text-zinc-600 font-mono text-xs">{dur(run)}</td>
                <td className="px-4 py-3 text-zinc-600 font-mono text-xs hidden md:table-cell">
                  {run.cost_usd !== null ? `$${run.cost_usd.toFixed(4)}` : "—"}
                </td>
                <td className="px-4 py-3 text-zinc-700 text-xs hidden lg:table-cell">{run.triggered_by}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs font-mono text-zinc-700">
                  — sin ejecuciones —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
