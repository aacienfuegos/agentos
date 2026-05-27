"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, Run, Agent } from "@/lib/api";
import { LogStream } from "@/components/LogStream";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-700 text-zinc-300",
  running: "bg-blue-900 text-blue-300",
  success: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
  cancelled: "bg-zinc-700 text-zinc-400",
};

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

function duration(run: Run): string {
  if (!run.started_at) return "—";
  const end = run.finished_at ? asUTC(run.finished_at) : new Date();
  const secs = Math.round((end.getTime() - asUTC(run.started_at).getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
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

    // Poll for status updates if run is active
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

  if (!run) return <div className="text-zinc-500 text-sm">Cargando…</div>;

  const isLive = run.status === "running" || run.status === "pending";
  const totalTokens = (run.tokens_input ?? 0) + (run.tokens_output ?? 0);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/runs" className="text-xs text-zinc-500 hover:text-zinc-400">← Ejecuciones</Link>
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">
            {agent?.name ?? run.agent_id}
          </h1>
          <p className="text-sm text-zinc-500 font-mono mt-1">{run.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {run.output && (
            <Button variant="outline" size="sm" onClick={exportMarkdown}
              className="border-zinc-700 hover:bg-zinc-800">
              Exportar .md
            </Button>
          )}
          {isLive && (
            <Button variant="destructive" size="sm" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? "Cancelando…" : "Cancelar"}
            </Button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">Estado</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[run.status]}`}>
            {run.status}
          </span>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">Duración</p>
          <p className="text-sm font-mono text-zinc-200">{duration(run)}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">Tokens</p>
          <p className="text-sm font-mono text-zinc-200">{totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k` : "—"}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-1">Coste</p>
          <p className="text-sm font-mono text-zinc-200">
            {run.cost_usd !== null ? `$${run.cost_usd.toFixed(4)}` : "—"}
          </p>
        </div>
      </div>

      {/* Output */}
      {run.output && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
            <span className="text-xs text-zinc-400 font-mono">Resultado</span>
            <button
              onClick={copyOutput}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Copiar resultado"
            >
              {copiedOutput ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedOutput ? "Copiado" : "Copiar"}
            </button>
          </div>
          <div className="p-4 prose prose-invert prose-sm max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-zinc-200 font-mono">{run.output}</pre>
          </div>
        </div>
      )}

      {/* Error */}
      {run.error && (
        <div className="bg-red-950 border border-red-900 rounded-lg p-4">
          <p className="text-xs text-red-400 font-mono mb-1">ERROR</p>
          <p className="text-sm text-red-200">{run.error}</p>
        </div>
      )}

      {/* Logs */}
      <LogStream runId={id} isLive={isLive} />
    </div>
  );
}
