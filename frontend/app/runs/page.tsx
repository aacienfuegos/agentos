"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api, Run, Agent, KnowledgeAgent, KnowledgeConversation } from "@/lib/api";
import { fmtTokens } from "@/lib/utils";
import { ChevronRight, ChevronDown } from "lucide-react";

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

const TRIGGERED_BY_BADGE: Record<string, string> = {
  manual:   "bg-zinc-800 text-zinc-400 border-zinc-700/50",
  schedule: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  api:      "bg-sky-500/10 text-sky-400 border-sky-500/20",
  chat:     "bg-amber-400/10 text-amber-400 border-amber-400/20",
};

function TriggeredByBadge({ value }: { value: string }) {
  const cls = TRIGGERED_BY_BADGE[value] ?? "bg-zinc-800 text-zinc-500 border-zinc-700/50";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-mono border ${cls}`}>
      {value}
    </span>
  );
}

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

type TableItem =
  | { kind: "run"; data: Run; sortKey: string }
  | { kind: "conv"; data: KnowledgeConversation; sortKey: string };

export default function RunsList() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [convs, setConvs] = useState<KnowledgeConversation[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [kaMap, setKaMap] = useState<Record<string, KnowledgeAgent>>({});
  const [statusFilter, setStatusFilter] = useState<Set<Run["status"]>>(new Set());
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [childRuns, setChildRuns] = useState<Record<string, Run[]>>({});
  const [loadingChildren, setLoadingChildren] = useState<Set<string>>(new Set());

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const fetchData = useCallback(async (newPage: number, statuses: Set<Run["status"]>, agentId: string) => {
    setLoading(true);
    try {
      const [runsResult, convsResult] = await Promise.all([
        api.runs.list({
          limit: PAGE_SIZE,
          offset: newPage * PAGE_SIZE,
          top_level: true,
          ...(statuses.size > 0 ? { statuses: [...statuses] } : {}),
          ...(agentId ? { agent_id: agentId } : {}),
        }),
        agentId ? Promise.resolve([]) : api.runs.knowledgeConversations({ limit: PAGE_SIZE }),
      ]);
      setRuns(runsResult);
      setConvs(convsResult);
      setHasMore(runsResult.length === PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      api.agents.list(),
      api.knowledgeAgents.list(),
    ]).then(([agList, kaList]) => {
      setAgents(agList);
      setKaMap(Object.fromEntries(kaList.map((ka) => [ka.id, ka])));
    });
  }, []);

  useEffect(() => {
    setPage(0);
    fetchData(0, statusFilter, agentFilter);
  }, [statusFilter, agentFilter, fetchData]);

  const toggleStatus = (s: Run["status"]) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const toggleExpand = async (key: string, fetchFn: () => Promise<Run[]>) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    if (childRuns[key] !== undefined) return;
    setLoadingChildren((prev) => new Set(prev).add(key));
    const children = await fetchFn();
    setChildRuns((prev) => ({ ...prev, [key]: children }));
    setLoadingChildren((prev) => { const s = new Set(prev); s.delete(key); return s; });
  };

  const goToPage = (newPage: number) => {
    setPage(newPage);
    fetchData(newPage, statusFilter, agentFilter);
  };

  // Merge runs and conversations sorted by most recent activity
  const items: TableItem[] = [
    ...runs.map((r): TableItem => ({ kind: "run", data: r, sortKey: r.created_at })),
    ...(!agentFilter ? convs.map((c): TableItem => ({ kind: "conv", data: c, sortKey: c.last_at })) : []),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight">Ejecuciones</h1>

        <div className="flex items-center gap-2 flex-wrap">
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
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs font-mono text-zinc-700">
                  cargando…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-xs font-mono text-zinc-700">
                  — sin ejecuciones —
                </td>
              </tr>
            ) : (
              items.map((item, i) => {
                const isLast = i === items.length - 1;

                if (item.kind === "conv") {
                  const conv = item.data;
                  const kaName = kaMap[conv.knowledge_agent_id]?.name ?? conv.knowledge_agent_id;
                  const key = `conv:${conv.conversation_id}`;
                  const isExpanded = expandedRuns.has(key);
                  const children = childRuns[key];
                  const isLastWithExpanded = isLast && !isExpanded;

                  return [
                    <tr
                      key={key}
                      className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors ${isLastWithExpanded ? "border-b-0" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleExpand(key, () => api.runs.list({ conversation_id: conv.conversation_id, limit: 100 }))}
                            className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          <Link
                            href={`/knowledge-agents/${conv.knowledge_agent_id}?conv=${conv.conversation_id}`}
                            className="text-zinc-300 hover:text-amber-400 transition-colors font-medium"
                          >
                            <span className="text-zinc-600 font-normal">Knowledge · </span>{kaName}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-zinc-600">{conv.turn_count} turnos</span>
                      </td>
                      <td className="px-4 py-3 text-zinc-600 font-mono text-xs hidden sm:table-cell">
                        {fmt(conv.first_at)}
                      </td>
                      <td className="px-4 py-3 text-zinc-600 font-mono text-xs">
                        {fmt(conv.last_at).split(",")[1]?.trim() ?? "—"}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell" />
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-mono border bg-teal-500/10 text-teal-400 border-teal-500/20">
                          knowledge
                        </span>
                      </td>
                    </tr>,

                    isExpanded && (
                      loadingChildren.has(key) ? (
                        <tr key={`${key}-loading`} className="border-b border-white/[0.03]">
                          <td colSpan={6} className="pl-10 py-2 text-[11px] font-mono text-zinc-700">cargando···</td>
                        </tr>
                      ) : children?.length === 0 ? (
                        <tr key={`${key}-empty`} className={`border-b border-white/[0.03] ${isLast ? "border-b-0" : ""}`}>
                          <td colSpan={6} className="pl-10 py-2 text-[11px] font-mono text-zinc-700">— sin runs —</td>
                        </tr>
                      ) : (
                        children?.map((child, ci) => {
                          const isLastChild = ci === (children?.length ?? 0) - 1 && isLast;
                          const userMsg = String((child.input_params as Record<string, unknown>).user_message ?? "").slice(0, 60);
                          return (
                            <tr
                              key={child.id}
                              className={`border-b border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.03] transition-colors ${isLastChild ? "border-b-0" : ""}`}
                            >
                              <td className="pl-9 pr-4 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-800 font-mono text-xs shrink-0">└</span>
                                  <Link
                                    href={`/runs/${child.id}`}
                                    className="text-zinc-500 hover:text-amber-400 transition-colors text-xs font-mono truncate max-w-[200px]"
                                    title={userMsg}
                                  >
                                    {userMsg || child.id.slice(0, 8)}
                                  </Link>
                                </div>
                              </td>
                              <td className="px-4 py-2">
                                <span className="flex items-center gap-1.5">
                                  <span className={`w-1 h-1 rounded-full shrink-0 ${STATUS_DOT[child.status]}`} />
                                  <span className={`text-[11px] font-mono ${STATUS_TEXT[child.status]}`}>
                                    {STATUS_LABEL[child.status] ?? child.status}
                                  </span>
                                </span>
                              </td>
                              <td className="px-4 py-2 text-zinc-700 font-mono text-[11px] hidden sm:table-cell">{fmt(child.started_at ?? child.created_at)}</td>
                              <td className="px-4 py-2 text-zinc-700 font-mono text-[11px]">{dur(child)}</td>
                              <td className="px-4 py-2 text-zinc-700 font-mono text-[11px] hidden md:table-cell">
                                {child.tokens_input !== null && child.tokens_output !== null
                                  ? fmtTokens(child.tokens_input + child.tokens_output)
                                  : "—"}
                              </td>
                              <td className="px-4 py-2 hidden lg:table-cell">
                                <TriggeredByBadge value={child.triggered_by} />
                              </td>
                            </tr>
                          );
                        })
                      )
                    ),
                  ];
                }

                // Regular run row
                const run = item.data;
                const isExpanded = expandedRuns.has(run.id);
                const isLastRow = isLast && !isExpanded;
                const children = childRuns[run.id];

                return [
                  <tr
                    key={run.id}
                    className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors ${isLastRow ? "border-b-0" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {run.status === "success" && run.agent_id !== "__execute__" ? (
                          <button
                            onClick={() => toggleExpand(run.id, () => api.runs.list({ original_run_id: run.id, limit: 50 }))}
                            className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                          >
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        ) : (
                          <span className="w-3.5 shrink-0" />
                        )}
                        <Link
                          href={`/runs/${run.id}`}
                          className="text-zinc-300 hover:text-amber-400 transition-colors font-medium"
                        >
                          {run.agent_id === "__execute__"
                            ? `api: ${run.input_params?.api_key_name ?? "external"}`
                            : (agentMap[run.agent_id]?.name ?? run.agent_id)}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[run.status]}`} />
                        <span className={`text-xs font-mono ${STATUS_TEXT[run.status]}`}>
                          {STATUS_LABEL[run.status] ?? run.status}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 font-mono text-xs hidden sm:table-cell">{fmt(run.started_at ?? run.created_at)}</td>
                    <td className="px-4 py-3 text-zinc-600 font-mono text-xs">{dur(run)}</td>
                    <td className="px-4 py-3 text-zinc-600 font-mono text-xs hidden md:table-cell">
                      {run.tokens_input !== null && run.tokens_output !== null
                        ? fmtTokens(run.tokens_input + run.tokens_output)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <TriggeredByBadge value={run.triggered_by} />
                    </td>
                  </tr>,

                  isExpanded && (
                    loadingChildren.has(run.id) ? (
                      <tr key={`${run.id}-loading`} className="border-b border-white/[0.03]">
                        <td colSpan={6} className="pl-10 py-2 text-[11px] font-mono text-zinc-700">cargando···</td>
                      </tr>
                    ) : children?.length === 0 ? (
                      <tr key={`${run.id}-empty`} className={`border-b border-white/[0.03] ${isLast ? "border-b-0" : ""}`}>
                        <td colSpan={6} className="pl-10 py-2 text-[11px] font-mono text-zinc-700">— sin chats —</td>
                      </tr>
                    ) : (
                      children?.map((child, ci) => {
                        const isLastChild = ci === (children?.length ?? 0) - 1 && isLast;
                        const userMsg = String((child.input_params as Record<string, unknown>).user_message ?? "").slice(0, 60);
                        return (
                          <tr
                            key={child.id}
                            className={`border-b border-white/[0.03] bg-white/[0.01] hover:bg-white/[0.03] transition-colors ${isLastChild ? "border-b-0" : ""}`}
                          >
                            <td className="pl-9 pr-4 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-zinc-800 font-mono text-xs shrink-0">└</span>
                                <Link
                                  href={`/runs/${child.id}`}
                                  className="text-zinc-500 hover:text-amber-400 transition-colors text-xs font-mono truncate max-w-[200px]"
                                  title={userMsg}
                                >
                                  {userMsg || child.id.slice(0, 8)}
                                </Link>
                              </div>
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-1.5">
                                <span className={`w-1 h-1 rounded-full shrink-0 ${STATUS_DOT[child.status]}`} />
                                <span className={`text-[11px] font-mono ${STATUS_TEXT[child.status]}`}>
                                  {STATUS_LABEL[child.status] ?? child.status}
                                </span>
                              </span>
                            </td>
                            <td className="px-4 py-2 text-zinc-700 font-mono text-[11px] hidden sm:table-cell">{fmt(child.started_at ?? child.created_at)}</td>
                            <td className="px-4 py-2 text-zinc-700 font-mono text-[11px]">{dur(child)}</td>
                            <td className="px-4 py-2 text-zinc-700 font-mono text-[11px] hidden md:table-cell">
                              {child.tokens_input !== null && child.tokens_output !== null
                                ? fmtTokens(child.tokens_input + child.tokens_output)
                                : "—"}
                            </td>
                            <td className="px-4 py-2 hidden lg:table-cell">
                              <TriggeredByBadge value={child.triggered_by} />
                            </td>
                          </tr>
                        );
                      })
                    )
                  ),
                ];
              })
            )}
          </tbody>
        </table>
      </div>

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
