"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { diffLines } from "diff";
import { Copy, Check, ChevronDown, ChevronRight, ArrowDown } from "lucide-react";
import { api, LogEntry } from "@/lib/api";

interface LogEvent {
  level: "info" | "tool_use" | "tool_result" | "error" | "done";
  message: string;
  metadata?: Record<string, unknown> | null;
}

type DisplayItem =
  | { kind: "info"; message: string; id: number }
  | { kind: "tool"; name: string; input: Record<string, unknown>; result: string | null; id: number }
  | { kind: "error"; message: string; id: number };

function processLogs(logs: LogEvent[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let id = 0;
  let i = 0;
  while (i < logs.length) {
    const log = logs[i];
    if (log.level === "tool_use") {
      const name = String(log.metadata?.tool ?? "?");
      const input = (log.metadata?.input ?? {}) as Record<string, unknown>;
      let result: string | null = null;
      if (i + 1 < logs.length && logs[i + 1].level === "tool_result") {
        result = logs[i + 1].message;
        i += 2;
      } else {
        i++;
      }
      items.push({ kind: "tool", name, input, result, id: id++ });
    } else if (log.level === "info") {
      items.push({ kind: "info", message: log.message, id: id++ });
      i++;
    } else if (log.level === "error") {
      items.push({ kind: "error", message: log.message, id: id++ });
      i++;
    } else {
      i++;
    }
  }
  return items;
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  const file = String(input.file_path ?? input.path ?? "");
  if (file) {
    const parts = file.split("/");
    const short = parts.length > 2 ? "…/" + parts.slice(-2).join("/") : file;
    return `${name} → ${short}`;
  }
  if (input.command) return `${name} → ${String(input.command).slice(0, 60)}`;
  if (input.query) return `${name} → ${String(input.query).slice(0, 60)}`;
  if (input.pattern) return `${name} → ${String(input.pattern).slice(0, 40)}`;
  if (input.url) return `${name} → ${String(input.url).slice(0, 60)}`;
  return name;
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(ref.current?.textContent ?? "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group my-2">
      <pre
        ref={ref}
        className="bg-zinc-900 border border-white/[0.06] rounded-lg px-4 py-3 overflow-x-auto text-xs leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap"
      >
        {children}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-zinc-800/80 rounded"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-zinc-500" />}
      </button>
    </div>
  );
}

const mdComponents: Components = {
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
  code({ children, className }) {
    const text = String(children ?? "");
    if (className || text.includes("\n")) {
      return <code className={`font-mono text-zinc-300 text-xs ${className ?? ""}`}>{children}</code>;
    }
    return <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-amber-300 text-[0.85em] font-mono">{children}</code>;
  },
  h1({ children }) { return <h1 className="text-xl font-bold text-zinc-100 mt-5 mb-2 leading-tight">{children}</h1>; },
  h2({ children }) { return <h2 className="text-lg font-semibold text-zinc-200 mt-4 mb-1.5 leading-tight">{children}</h2>; },
  h3({ children }) { return <h3 className="text-base font-semibold text-zinc-300 mt-3 mb-1 leading-tight">{children}</h3>; },
  h4({ children }) { return <h4 className="text-sm font-medium text-zinc-300 mt-2 mb-0.5">{children}</h4>; },
  h5({ children }) { return <h5 className="text-sm font-medium text-zinc-400 mt-2 mb-0.5">{children}</h5>; },
  h6({ children }) { return <h6 className="text-xs font-medium text-zinc-500 mt-1.5 mb-0.5 uppercase tracking-wide">{children}</h6>; },
  p({ children }) { return <p className="mb-3 text-zinc-300 leading-relaxed">{children}</p>; },
  ul({ children }) { return <ul className="list-disc pl-5 my-2 space-y-1 text-zinc-300">{children}</ul>; },
  ol({ children }) { return <ol className="list-decimal pl-5 my-2 space-y-1 text-zinc-300">{children}</ol>; },
  li({ children }) { return <li className="leading-relaxed">{children}</li>; },
  strong({ children }) { return <strong className="text-zinc-100 font-semibold">{children}</strong>; },
  em({ children }) { return <em className="text-zinc-400 italic">{children}</em>; },
  del({ children }) { return <del className="text-zinc-600 line-through">{children}</del>; },
  a({ children, href }) {
    return <a href={href} className="text-amber-400 hover:text-amber-300 underline" target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  blockquote({ children }) {
    return <blockquote className="border-l-2 border-zinc-700 pl-3 text-zinc-500 italic my-2">{children}</blockquote>;
  },
  hr() { return <hr className="border-zinc-800 my-4" />; },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) { return <thead className="bg-white/[0.04]">{children}</thead>; },
  tbody({ children }) { return <tbody className="divide-y divide-white/[0.04]">{children}</tbody>; },
  tr({ children }) { return <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>; },
  th({ children }) {
    return <th className="px-4 py-2.5 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider whitespace-nowrap">{children}</th>;
  },
  td({ children }) { return <td className="px-4 py-2.5 text-zinc-300 align-top">{children}</td>; },
  input({ checked, disabled }) {
    return <input type="checkbox" checked={checked ?? false} disabled={disabled} readOnly className="mr-1.5 accent-amber-400" />;
  },
};

export function InfoMessage({ message }: { message: string }) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown components={mdComponents} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>{message}</ReactMarkdown>
    </div>
  );
}

function EditDiff({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const changes = diffLines(oldStr, newStr);
  return (
    <div className="rounded-lg overflow-auto border border-white/[0.04] text-xs font-mono max-h-48 mt-2">
      {changes.map((part, pi) => {
        const lines = part.value.split("\n");
        if (lines[lines.length - 1] === "") lines.pop();
        return lines.map((line, li) => (
          <div
            key={`${pi}-${li}`}
            className={`px-3 py-px leading-relaxed ${
              part.added
                ? "bg-emerald-950/30 text-emerald-300/90"
                : part.removed
                ? "bg-red-950/30 text-red-300/80"
                : "text-zinc-700"
            }`}
          >
            <span className="select-none mr-2 opacity-50">
              {part.added ? "+" : part.removed ? "-" : " "}
            </span>
            {line}
          </div>
        ));
      })}
    </div>
  );
}

function ToolRow({
  name,
  input,
  result,
}: {
  name: string;
  input: Record<string, unknown>;
  result: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = toolSummary(name, input);
  const isEdit = name === "Edit" && typeof input.old_string === "string" && typeof input.new_string === "string";
  const isWrite = name === "Write" && typeof input.content === "string";

  return (
    <div className="border border-white/[0.04] rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-left hover:bg-white/[0.02] transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
        )}
        <span className="text-yellow-400/80 flex-1 truncate">{summary}</span>
        {result === null && (
          <span className="text-zinc-700 text-[10px] animate-pulse">···</span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-white/[0.04]">
          {isEdit ? (
            <EditDiff oldStr={String(input.old_string)} newStr={String(input.new_string)} />
          ) : isWrite ? (
            <CodeBlock>{String(input.content)}</CodeBlock>
          ) : (
            <pre className="mt-1.5 text-zinc-600 text-xs font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
              {JSON.stringify(input, null, 2)}
            </pre>
          )}
          {result !== null && (
            <div className="text-xs font-mono border-t border-white/[0.04] pt-2">
              <span className="text-zinc-700 text-[10px] uppercase tracking-widest mr-2">
                resultado
              </span>
              <span className="text-cyan-400/60 whitespace-pre-wrap">
                {result.length > 400 ? result.slice(0, 400) + "…" : result}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function entryToEvent(entry: LogEntry): LogEvent {
  return { level: entry.level, message: entry.message, metadata: entry.extra };
}

export function LogStream({
  runId,
  isLive,
  showInfo = false,
}: {
  runId: string;
  isLive: boolean;
  showInfo?: boolean;
}) {
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastEventMs = useRef(Date.now());
  const backendUrl = "";

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setPendingCount(0);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollTop + el.clientHeight >= el.scrollHeight - 60;
    atBottomRef.current = near;
    setAtBottom(near);
    if (near) setPendingCount(0);
  }, []);

  // Auto-scroll when new logs arrive
  useEffect(() => {
    if (logs.length === 0) return;
    lastEventMs.current = Date.now();
    setThinking(false);
    if (atBottomRef.current) {
      scrollToBottom();
    } else {
      setPendingCount((c) => c + 1);
    }
  }, [logs, scrollToBottom]);

  // Activity indicator — shows after 2s of silence while live
  useEffect(() => {
    if (!isLive) {
      setThinking(false);
      return;
    }
    const timer = setInterval(() => {
      setThinking(Date.now() - lastEventMs.current > 2000);
    }, 500);
    return () => clearInterval(timer);
  }, [isLive]);

  // Finished runs: fetch from REST
  useEffect(() => {
    if (isLive) return;
    api.runs.getLogs(runId).then((entries) => {
      const levels = showInfo
        ? new Set(["info", "tool_use", "tool_result", "error"])
        : new Set(["tool_use", "tool_result", "error"]);
      setLogs(entries.map(entryToEvent).filter((e) => levels.has(e.level)));
    });
  }, [runId, isLive, showInfo]);

  // Live runs: SSE stream
  useEffect(() => {
    if (!isLive) return;
    const levels = showInfo
      ? new Set(["info", "tool_use", "tool_result", "error"])
      : new Set(["tool_use", "tool_result", "error"]);

    const es = new EventSource(`${backendUrl}/api/runs/${runId}/stream`, {
      withCredentials: true,
    });
    setConnected(true);

    es.onmessage = (e: MessageEvent) => {
      try {
        const event: LogEvent = JSON.parse(e.data);
        if (levels.has(event.level)) setLogs((prev) => [...prev, event]);
      } catch { /* ignore */ }
    };

    es.addEventListener("done", () => {
      es.close();
      setConnected(false);
    });

    es.onerror = () => {
      setConnected(false);
      es.close();
      api.runs.getLogs(runId).then((entries) => {
        const filtered = entries.map(entryToEvent).filter((e) => levels.has(e.level));
        if (filtered.length > 0) setLogs(filtered);
      });
    };

    return () => es.close();
  }, [runId, isLive, showInfo]);

  const copyLogs = () => {
    const text = logs
      .map((log) => {
        if (log.level === "tool_use" && log.metadata) {
          return `[TOOL] ${String(log.metadata.tool)} → ${JSON.stringify(log.metadata.input)}`;
        }
        return `[${log.level.toUpperCase()}] ${log.message}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const items = processLogs(logs);

  return (
    <div className="flex flex-col h-full rounded-xl border border-white/[0.06] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-2 text-xs font-mono text-zinc-600">
          <span>{logs.length} eventos</span>
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
            className="flex items-center gap-1.5 text-xs font-mono text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5"
      >
        {items.length === 0 && !thinking && (
          <p className="text-zinc-600 text-xs font-mono px-1">
            {isLive ? "Esperando herramientas…" : "El agente respondió sin usar herramientas."}
          </p>
        )}

        {items.map((item) => {
          if (item.kind === "tool") {
            return (
              <ToolRow key={item.id} name={item.name} input={item.input} result={item.result} />
            );
          }
          if (item.kind === "info") {
            return (
              <div key={item.id} className="px-1">
                <InfoMessage message={item.message} />
              </div>
            );
          }
          if (item.kind === "error") {
            return (
              <div
                key={item.id}
                className="rounded-lg bg-red-950/20 border border-red-500/20 px-3 py-2 text-xs font-mono text-red-400"
              >
                <span className="text-red-600 mr-2 text-[10px] uppercase tracking-widest">error</span>
                {item.message}
              </div>
            );
          }
          return null;
        })}

        {thinking && (
          <div className="flex items-center gap-1 px-1 py-1">
            <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-zinc-600 rounded-full animate-bounce [animation-delay:300ms]" />
          </div>
        )}
      </div>

      {!atBottom && pendingCount > 0 && (
        <div className="flex justify-center py-2 border-t border-white/[0.04] shrink-0 bg-zinc-950/50">
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowDown className="w-3 h-3" />
            {pendingCount} nuevo{pendingCount !== 1 ? "s" : ""} — ir al final
          </button>
        </div>
      )}
    </div>
  );
}
