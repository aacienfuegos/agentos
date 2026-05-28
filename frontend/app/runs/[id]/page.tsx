"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Run } from "@/lib/api";
import { LogStream } from "@/components/LogStream";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, Download } from "lucide-react";

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

const STATUS_LABELS: Record<string, string> = {
  pending:   "pendiente",
  running:   "ejecutando",
  success:   "ok",
  failed:    "error",
  cancelled: "cancelado",
};

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

function duration(run: Run): string {
  if (!run.started_at) return "—";
  const end = run.finished_at ? asUTC(run.finished_at) : new Date();
  const secs = Math.round((end.getTime() - asUTC(run.started_at).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function MetaDot() {
  return <span className="text-zinc-700">·</span>;
}

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [agentLink, setAgentLink] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  useEffect(() => {
    const load = async () => {
      const r = await api.runs.get(id);
      setRun(r);
      if (r.agent_id.startsWith("knowledge:")) {
        const kaId = r.agent_id.slice("knowledge:".length);
        try {
          const ka = await api.knowledgeAgents.get(kaId);
          setAgentName(ka.name);
          const convId = (r.input_params as Record<string, string>).conversation_id;
          setAgentLink(`/knowledge-agents/${kaId}${convId ? `?conv=${convId}` : ""}`);
        } catch { setAgentName(r.agent_id); }
      } else {
        try {
          const a = await api.agents.get(r.agent_id);
          setAgentName(a.name);
        } catch { setAgentName(r.agent_id); }
      }
    };
    load();

    const interval = setInterval(async () => {
      const r = await api.runs.get(id);
      setRun(r);
      if (r.status !== "running" && r.status !== "pending") {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [id]);

  const handleCancel = async () => {
    if (!confirm("¿Cancelar esta ejecución?")) return;
    setCancelling(true);
    await api.runs.cancel(id);
    setRun((r) => r ? { ...r, status: "cancelled" } : r);
    setCancelling(false);
  };

  const copyOutput = () => {
    if (!run?.output) return;
    navigator.clipboard.writeText(run.output).then(() => {
      setCopiedOutput(true);
      setTimeout(() => setCopiedOutput(false), 2000);
    });
  };

  const exportMarkdown = () => {
    if (!run?.output) return;
    const blob = new Blob([run.output], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${id.slice(0, 8)}.md`;
    a.click();
  };

  if (!run) return <div className="text-zinc-500 text-sm p-8">Cargando…</div>;

  const isLive = run.status === "running" || run.status === "pending";
  const totalTokens = (run.tokens_input ?? 0) + (run.tokens_output ?? 0);

  return (
    // nav=56px + py-8 top+bottom=64px → contenido ocupa exactamente lo que queda
    <div className="flex flex-col gap-4 h-[calc(100dvh-120px)] w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 shrink-0">
        <Link href="/runs" className="text-xs text-zinc-500 hover:text-zinc-400 inline-flex items-center gap-1">
          ← Ejecuciones
        </Link>
        {agentLink && (
          <>
            <span className="text-zinc-800">·</span>
            <Link href={agentLink} className="text-xs text-zinc-500 hover:text-amber-400 transition-colors">
              volver al chat →
            </Link>
          </>
        )}
      </div>

      {/* Header row */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight truncate">
              {agentName ?? run.agent_id}
            </h1>
            <span className="flex items-center gap-1.5 shrink-0">
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[run.status]}`} />
              <span className={`text-xs font-mono ${STATUS_TEXT[run.status]}`}>
                {STATUS_LABELS[run.status] ?? run.status}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-500 font-mono flex-wrap">
            <span>{id.slice(0, 8)}</span>
            <MetaDot />
            <span>{duration(run)}</span>
            {totalTokens > 0 && (
              <>
                <MetaDot />
                <span>{(totalTokens / 1000).toFixed(1)}k tokens</span>
              </>
            )}
            {run.cost_usd !== null && (
              <>
                <MetaDot />
                <span>${run.cost_usd.toFixed(4)}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {run.output && (
            <button onClick={exportMarkdown}
              className="flex items-center gap-1.5 text-xs font-mono text-zinc-600 hover:text-zinc-300 transition-colors px-2.5 py-1 rounded-md hover:bg-white/5">
              <Download className="w-3 h-3" />
              .md
            </button>
          )}
          {isLive && (
            <button onClick={handleCancel} disabled={cancelling}
              className="text-xs font-mono text-red-500 hover:text-red-400 px-2.5 py-1 rounded-md hover:bg-red-500/10 transition-colors disabled:opacity-50">
              {cancelling ? "cancelando···" : "cancelar"}
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {run.error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 shrink-0">
          <p className="text-[11px] font-mono uppercase tracking-widest text-red-500/60 mb-1">error</p>
          <p className="text-sm font-mono text-red-300">{run.error}</p>
        </div>
      )}

      {/* Tabs — flex-1 para ocupar el espacio restante */}
      <Tabs defaultValue={run.output ? "output" : "logs"} className="flex-1 min-h-0 gap-0">
        <TabsList className="bg-transparent border-0 shrink-0 p-0 gap-1">
          <TabsTrigger value="output" className="text-xs font-mono px-3 py-1.5 rounded-md data-active:bg-white/[0.06] data-active:text-zinc-100 text-zinc-500 hover:text-zinc-300">
            resultado
          </TabsTrigger>
          <TabsTrigger value="logs" className="text-xs font-mono px-3 py-1.5 rounded-md data-active:bg-white/[0.06] data-active:text-zinc-100 text-zinc-500 hover:text-zinc-300">
            logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="output" className="mt-2 min-h-0 overflow-hidden flex flex-col" keepMounted>
          {run.output ? (
            <div className="flex flex-col flex-1 min-h-0 rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] shrink-0">
                <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">
                  {(run.output.length / 1000).toFixed(1)}k chars
                </span>
                <button
                  onClick={copyOutput}
                  className="flex items-center gap-1.5 text-xs font-mono text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  {copiedOutput ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedOutput ? "copiado" : "copiar"}
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                <pre className="whitespace-pre-wrap text-sm text-zinc-300 font-mono leading-relaxed">{run.output}</pre>
              </div>
            </div>
          ) : (
            <div className="text-xs font-mono text-zinc-700 py-8 text-center">
              {isLive ? "ejecutando···" : "— sin resultado —"}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-2 min-h-0 overflow-hidden flex flex-col" keepMounted>
          <LogStream runId={id} isLive={isLive} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
