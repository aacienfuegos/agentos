"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { api, LogEntry } from "@/lib/api";

interface LogEvent {
  level: "info" | "tool_use" | "tool_result" | "error" | "done";
  message: string;
  metadata?: Record<string, unknown> | null;
}

// Only execution trace events — text output lives in the Resultado tab
const DISPLAY_LEVELS = new Set(["tool_use", "tool_result", "error"]);

const LEVEL_STYLES: Record<string, string> = {
  tool_use: "text-yellow-400",
  tool_result: "text-cyan-400",
  error: "text-red-400",
};

const LEVEL_PREFIX: Record<string, string> = {
  tool_use: "[TOOL]",
  tool_result: "[RESULT]",
  error: "[ERROR]",
};

function entryToEvent(entry: LogEntry): LogEvent {
  return { level: entry.level, message: entry.message, metadata: entry.extra };
}

export function LogStream({ runId, isLive }: { runId: string; isLive: boolean }) {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

  // Finished runs: fetch from REST
  useEffect(() => {
    if (isLive) return;
    api.runs.getLogs(runId).then((entries) => {
      setLogs(entries.map(entryToEvent).filter((e) => DISPLAY_LEVELS.has(e.level)));
    });
  }, [runId, isLive]);

  // Live runs: SSE stream
  useEffect(() => {
    if (!isLive) return;

    const es = new EventSource(`${backendUrl}/api/runs/${runId}/stream`);
    setConnected(true);

    const handleMessage = (e: MessageEvent) => {
      try {
        const event: LogEvent = JSON.parse(e.data);
        if (DISPLAY_LEVELS.has(event.level)) {
          setLogs((prev) => [...prev, event]);
        }
      } catch {
        // ignore parse errors
      }
    };

    const handleDone = () => {
      es.close();
      setConnected(false);
    };

    es.onmessage = handleMessage;
    // Named "done" event sent by the backend when streaming historical logs
    es.addEventListener("done", handleDone);

    es.onerror = () => {
      setConnected(false);
      es.close();
      api.runs.getLogs(runId).then((entries) => {
        const filtered = entries.map(entryToEvent).filter((e) => DISPLAY_LEVELS.has(e.level));
        if (filtered.length > 0) setLogs(filtered);
      });
    };

    return () => es.close();
  }, [runId, isLive, backendUrl]);

  useEffect(() => {
    if (isLive) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, isLive]);

  const copyLogs = () => {
    const text = logs
      .map((log) => {
        const prefix = LEVEL_PREFIX[log.level] ?? "[LOG]";
        if (log.level === "tool_use" && log.metadata) {
          return `${prefix} ${String(log.metadata.tool)} → ${JSON.stringify(log.metadata.input)}`;
        }
        return `${prefix} ${log.message}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="font-mono">{logs.length} eventos</span>
          {connected && isLive && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              en vivo
            </span>
          )}
        </div>
        {logs.length > 0 && (
          <button
            onClick={copyLogs}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        )}
      </div>
      <div className="font-mono text-xs p-4 flex-1 min-h-0 overflow-y-auto space-y-1">
        {logs.length === 0 && (
          <p className="text-zinc-600">
            {isLive ? "Esperando herramientas…" : "El agente respondió sin usar herramientas."}
          </p>
        )}
        {logs.map((log, i) => (
          <div key={i} className={`${LEVEL_STYLES[log.level] ?? "text-zinc-400"} leading-relaxed`}>
            <span className="text-zinc-600 mr-2">{LEVEL_PREFIX[log.level] ?? "[LOG]"}</span>
            {log.level === "tool_use" && log.metadata ? (
              <span>
                <span className="text-yellow-300">{String(log.metadata.tool)}</span>
                {" → "}
                <span className="text-zinc-400">{JSON.stringify(log.metadata.input).slice(0, 120)}</span>
              </span>
            ) : (
              <span className="whitespace-pre-wrap">{log.message}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
