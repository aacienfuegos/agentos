"use client";

import { useEffect, useState, useCallback } from "react";
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

const STATUSES: Run["status"][] = ["running", "success", "failed", "cancelled"];
const PAGE_SIZE = 20;

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

export default function RunsList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statusFilter, setStatusFilter] = useState<Set<Run["status"]>>(new Set());
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const fetchRuns = useCallback(async (newPage: number, statuses: Set<Run["status"]>, agentId: string) => {
    setLoading(true);
    try {
      const result = await api.runs.list({
        limit: PAGE_SIZE,
        offset: newPage * PAGE_SIZE,
        ...(statuses.size > 0 ? { statuses: [...statuses] } : {}),
        ...(agentId ? { agent_id: agentId } : {}),
      });
      setRuns(result);
      setHasMore(result.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.agents.list().then(setAgents);
  }, []);

  useEffect(() => {
    setPage(0);
    fetchRuns(0, statusFilter, agentFilter);
  }, [statusFilter, agentFilter, fetchRuns]);

  const toggleStatus = (s: Run["status"]) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchRuns(newPage, statusFilter, agentFilter);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight">Ejecuciones</h1>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Agent filter */}
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="bg-zinc-900 border border-white/[0.06] rounded-md text-xs font-mono text-zinc-400 px-2.5 py-1 focus:outline-none focus:border-amber-400/30 transition-colors"
          >
            <option value="">todos los agentes</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          {/* Status filter — pills multi-select, ninguna = todos */}
          <div className="flex items-center gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                  statusFilter.has(s) ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s]}`} />
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
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
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600 hidden md:table-cell">Tokens</th>
              <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600 hidden lg:table-cell">Origen</th>
            </tr>
          </thead>
          <tbody>
            {loading && runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs font-mono text-zinc-700">
                  cargando…
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs font-mono text-zinc-700">
                  — sin ejecuciones —
                </td>
              </tr>
            ) : (
              runs.map((run, i) => (
                <tr
                  key={run.id}
                  className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors ${
                    i === runs.length - 1 ? "border-b-0" : ""
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
                    {run.tokens_input !== null && run.tokens_output !== null
                      ? `${((run.tokens_input + run.tokens_output) / 1000).toFixed(1)}k`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-zinc-700 text-xs hidden lg:table-cell">{run.triggered_by}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs font-mono text-zinc-600">
        <span>{page * PAGE_SIZE + 1}–{page * PAGE_SIZE + runs.length}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page === 0 || loading}
            className="px-2.5 py-1 rounded-md transition-colors disabled:opacity-30 hover:text-zinc-400 disabled:cursor-not-allowed"
          >
            ← anterior
          </button>
          <span className="text-zinc-700">p.{page + 1}</span>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={!hasMore || loading}
            className="px-2.5 py-1 rounded-md transition-colors disabled:opacity-30 hover:text-zinc-400 disabled:cursor-not-allowed"
          >
            siguiente →
          </button>
        </div>
      </div>
    </div>
  );
}
