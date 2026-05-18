"use client";

import { useEffect, useRef, useState } from "react";

interface LogEvent {
  level: "info" | "tool_use" | "tool_result" | "error" | "done";
  message: string;
  metadata?: Record<string, unknown> | null;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "text-zinc-300",
  tool_use: "text-yellow-400",
  tool_result: "text-cyan-400",
  error: "text-red-400",
  done: "text-green-400",
};

const LEVEL_PREFIX: Record<string, string> = {
  info: "[INFO]",
  tool_use: "[TOOL]",
  tool_result: "[RESULT]",
  error: "[ERROR]",
  done: "[DONE]",
};

export function LogStream({ runId, isLive }: { runId: string; isLive: boolean }) {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

  useEffect(() => {
    const es = new EventSource(`${backendUrl}/api/runs/${runId}/stream`);
    setConnected(true);

    es.onmessage = (e) => {
      try {
        const event: LogEvent = JSON.parse(e.data);
        setLogs((prev) => [...prev, event]);
        if (event.level === "done") {
          es.close();
          setConnected(false);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
    };

    return () => es.close();
  }, [runId, backendUrl]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900">
        <span className="text-xs text-zinc-400 font-mono">Logs</span>
        {connected && isLive && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            en vivo
          </span>
        )}
      </div>
      <div className="font-mono text-xs p-4 max-h-[500px] overflow-y-auto space-y-1">
        {logs.length === 0 && (
          <p className="text-zinc-600">Esperando logs…</p>
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
