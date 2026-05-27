"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Agent } from "@/lib/api";
import type { Run } from "@/lib/api";
import { LogStream } from "@/components/LogStream";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, Download } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-900 text-blue-300 animate-pulse",
  success: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
  cancelled: "bg-zinc-700 text-zinc-400",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "pendiente",
  running: "ejecutando",
  success: "éxito",
  failed: "fallido",
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
  const [agent, setAgent] = useState<Agent | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  useEffect(() => {
    const load = async () => {
      const r = await api.runs.get(id);
      setRun(r);
      const a = await api.agents.get(r.agent_id);
      setAgent(a);
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
    <div className="flex flex-col gap-4 h-[calc(100vh-120px)] w-full">
      {/* Breadcrumb */}
      <Link href="/runs" className="text-xs text-zinc-500 hover:text-zinc-400 inline-flex items-center gap-1 shrink-0">
        ← Ejecuciones
      </Link>

      {/* Header row */}
      <div className="flex items-start justify-between gap-4 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-semibold text-zinc-100 truncate">
              {agent?.name ?? run.agent_id}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[run.status]}`}>
              {STATUS_LABELS[run.status] ?? run.status}
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
            <Button variant="outline" size="sm" onClick={exportMarkdown}
              className="border-zinc-700 hover:bg-zinc-800 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              .md
            </Button>
          )}
          {isLive && (
            <Button variant="destructive" size="sm" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelando…" : "Cancelar"}
            </Button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {run.error && (
        <div className="bg-red-950 border border-red-900 rounded-lg px-4 py-3 shrink-0">
          <p className="text-xs text-red-400 font-mono mb-1">ERROR</p>
          <p className="text-sm text-red-200">{run.error}</p>
        </div>
      )}

      {/* Tabs — flex-1 para ocupar el espacio restante */}
      <Tabs defaultValue={run.output ? "output" : "logs"} className="flex-1 min-h-0 gap-0">
        <TabsList className="bg-zinc-900 border border-zinc-800 shrink-0">
          <TabsTrigger value="output" className="text-xs">Resultado</TabsTrigger>
          <TabsTrigger value="logs" className="text-xs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="output" className="mt-2 min-h-0 overflow-hidden flex flex-col" keepMounted>
          {run.output ? (
            <div className="flex flex-col flex-1 min-h-0 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
                <span className="text-xs text-zinc-500 font-mono">
                  {(run.output.length / 1000).toFixed(1)}k chars
                </span>
                <button
                  onClick={copyOutput}
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {copiedOutput ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedOutput ? "Copiado" : "Copiar"}
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-5">
                <pre className="whitespace-pre-wrap text-sm text-zinc-200 font-mono leading-relaxed">{run.output}</pre>
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-600 py-8 text-center">
              {isLive ? "El agente está trabajando…" : "Sin resultado."}
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
