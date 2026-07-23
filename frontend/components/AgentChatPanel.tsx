"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Run } from "@/lib/api";
import { InfoMessage } from "@/components/LogStream";
import { fmtTokens, generateUUID } from "@/lib/utils";
import { Copy, Check, Code, List, Rows3 } from "lucide-react";

const STATUS_TEXT: Record<string, string> = {
  pending: "text-zinc-500",
  running: "text-sky-400",
  success: "text-emerald-400",
  failed: "text-red-400",
  cancelled: "text-zinc-600",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  run_id?: string;
  status?: Run["status"];
  tokens?: number;
}

interface LiveLogEvent {
  level: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}

interface ConversationSummary {
  id: string;
  firstMessage: string;
  turnCount: number;
  lastAt: string;
}

interface AgentChatPanelProps {
  agentId: string;
  originalRunId: string;
  initialSessionId: string;
  initialOutput: string;
  backendUrl: string;
  conversationId: string | null;
  onConversationChange: (id: string | null) => void;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return "ahora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function AgentChatPanel({
  agentId,
  originalRunId,
  initialSessionId,
  initialOutput,
  backendUrl,
  conversationId,
  onConversationChange,
}: AgentChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [convView, setConvView] = useState<"list" | "tabs">("list");
  const [latestSessionId, setLatestSessionId] = useState<string>(initialSessionId);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LiveLogEvent[]>([]);
  const [rawMessages, setRawMessages] = useState<Set<number>>(new Set());
  const [copiedMsg, setCopiedMsg] = useState<number | null>(null);
  const liveEsRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const runs = await api.runs.list({ original_run_id: originalRunId, limit: 200 });
    const groups = new Map<string, Run[]>();
    for (const run of runs) {
      const convId = (run.input_params as Record<string, string>).conversation_id;
      if (!convId) continue;
      if (!groups.has(convId)) groups.set(convId, []);
      groups.get(convId)!.push(run);
    }
    const summaries: ConversationSummary[] = [];
    for (const [convId, convRuns] of groups) {
      const sorted = [...convRuns].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      summaries.push({
        id: convId,
        firstMessage: String(
          (sorted[0].input_params as Record<string, unknown>).user_message ?? ""
        ).slice(0, 50),
        turnCount: sorted.length,
        lastAt: sorted[sorted.length - 1].created_at,
      });
    }
    summaries.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    setConversations(summaries);
  }, [originalRunId]);

  const loadConversationHistory = useCallback(async (convId: string) => {
    const allRuns = await api.runs.list({ original_run_id: originalRunId, limit: 200 });
    const convRuns = allRuns
      .filter((r) => (r.input_params as Record<string, string>).conversation_id === convId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const msgs: ChatMessage[] = [];
    for (const run of convRuns) {
      msgs.push({ role: "user", content: (run.input_params as Record<string, string>).user_message ?? "" });
      msgs.push({
        role: "assistant",
        content: run.status === "success" ? (run.output ?? "") : (run.error ?? "Error desconocido"),
        run_id: run.id,
        status: run.status,
        tokens: (run.tokens_input ?? 0) + (run.tokens_output ?? 0),
      });
    }
    setMessages(msgs);
    const lastWithSession = [...convRuns].reverse().find((r) => r.session_id);
    if (lastWithSession?.session_id) setLatestSessionId(lastWithSession.session_id);
  }, [originalRunId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (conversationId && !sending) loadConversationHistory(conversationId);
  }, [conversationId, loadConversationHistory, sending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveLogs]);

  useEffect(() => {
    return () => { liveEsRef.current?.close(); };
  }, []);

  const resetToNew = () => {
    setMessages([]);
    setLatestSessionId(initialSessionId);
    onConversationChange(null);
  };

  const finalizeRun = async (run_id: string) => {
    liveEsRef.current?.close();
    liveEsRef.current = null;
    let run = await api.runs.get(run_id);
    while (run.status === "running" || run.status === "pending") {
      await new Promise((r) => setTimeout(r, 300));
      run = await api.runs.get(run_id);
    }
    if (run.session_id) setLatestSessionId(run.session_id);
    setLiveLogs([]);
    setMessages((m) => {
      const updated = [...m];
      const last = updated[updated.length - 1];
      if (last?.role === "assistant") {
        updated[updated.length - 1] = {
          role: "assistant",
          content: run.status === "success" ? (run.output ?? "") : (run.error ?? "Error desconocido"),
          run_id,
          status: run.status,
          tokens: (run.tokens_input ?? 0) + (run.tokens_output ?? 0),
        };
      }
      return updated;
    });
    setSending(false);
    loadConversations();
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput("");
    setSending(true);
    setLiveLogs([]);

    const isFirstMessage = !conversationId;
    let convId = conversationId;
    if (!convId) {
      convId = generateUUID();
      onConversationChange(convId);
    }

    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    setMessages((m) => [...m, { role: "assistant", content: "", status: "pending" as const }]);

    try {
      const run = await api.runs.create(agentId, {
        user_message: userMsg,
        resume_session_id: latestSessionId,
        conversation_id: convId,
        original_run_id: originalRunId,
        ...(isFirstMessage && initialOutput ? { initial_context: initialOutput } : {}),
      });
      const run_id = run.id;

      liveEsRef.current?.close();
      const es = new EventSource(`${backendUrl}/api/runs/${run_id}/stream`, { withCredentials: true });
      liveEsRef.current = es;
      let finalized = false;

      const finish = () => {
        if (finalized) return;
        finalized = true;
        finalizeRun(run_id);
      };

      es.onmessage = (e: MessageEvent) => {
        try {
          const event: LiveLogEvent = JSON.parse(e.data as string);
          if (["info", "tool_use", "tool_result", "error"].includes(event.level)) {
            setLiveLogs((prev) => [...prev, event]);
          }
          if (event.level === "done" || event.level === "error") finish();
        } catch { /* ignore parse errors */ }
      };

      es.addEventListener("done", finish);
      es.onerror = () => { es.close(); finish(); };
    } catch (err) {
      setLiveLogs([]);
      setMessages((m) => {
        const updated = [...m];
        updated[updated.length - 1] = {
          role: "assistant",
          content: err instanceof Error ? err.message : "Error al enviar consulta",
          status: "failed",
        };
        return updated;
      });
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Conversation selector */}
      {convView === "list" ? (
        <div className="shrink-0 rounded-xl border border-white/[0.06] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
            <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">conversaciones</span>
            <div className="flex items-center gap-2">
              <button
                onClick={resetToNew}
                disabled={sending}
                className="text-[11px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-30"
              >
                + nueva
              </button>
              <button
                onClick={() => setConvView("tabs")}
                title="Ver como tabs"
                className="text-zinc-700 hover:text-zinc-400 transition-colors"
              >
                <Rows3 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {conversations.length === 0 ? (
            <div className="px-3 py-2.5 text-[11px] font-mono text-zinc-700">— sin conversaciones previas —</div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onConversationChange(conv.id)}
                disabled={sending}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left text-[11px] font-mono border-b border-white/[0.03] last:border-b-0 transition-colors disabled:opacity-50 ${
                  conversationId === conv.id
                    ? "bg-amber-400/[0.06] text-amber-400"
                    : "text-zinc-500 hover:bg-white/[0.02] hover:text-zinc-300"
                }`}
              >
                <span className={`w-1 h-1 rounded-full shrink-0 ${conversationId === conv.id ? "bg-amber-400" : "bg-zinc-700"}`} />
                <span className="flex-1 truncate">{conv.firstMessage || conv.id.slice(0, 8)}</span>
                <span className="text-zinc-700 shrink-0">{conv.turnCount}t</span>
                <span className="text-zinc-700 shrink-0">{relTime(conv.lastAt)}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="shrink-0 flex items-center gap-2 flex-wrap">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onConversationChange(conv.id)}
              disabled={sending}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors disabled:opacity-50 ${
                conversationId === conv.id
                  ? "bg-amber-400/10 border border-amber-400/20 text-amber-400"
                  : "bg-white/[0.03] border border-white/[0.06] text-zinc-500 hover:text-zinc-300"
              }`}
              title={conv.firstMessage}
            >
              <span className="max-w-[120px] truncate">{conv.firstMessage || conv.id.slice(0, 8)}</span>
              <span className="text-zinc-700">·</span>
              <span>{conv.turnCount}t</span>
              <span className="text-zinc-700">·</span>
              <span>{relTime(conv.lastAt)}</span>
            </button>
          ))}
          <button
            onClick={resetToNew}
            disabled={sending}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-colors disabled:opacity-30 ${
              conversationId === null
                ? "bg-white/[0.06] border border-white/[0.1] text-zinc-300"
                : "text-zinc-600 hover:text-zinc-400 border border-transparent"
            }`}
          >
            + nueva
          </button>
          <button
            onClick={() => setConvView("list")}
            title="Ver como lista"
            className="text-zinc-700 hover:text-zinc-400 transition-colors ml-1"
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/[0.06] p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-xl px-4 py-3 text-sm bg-white/[0.03] border border-white/[0.06] text-zinc-300">
              <p className="text-[11px] font-mono text-zinc-700 mb-2">resultado del run</p>
              <InfoMessage message={initialOutput} />
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
              msg.role === "user"
                ? "bg-amber-400/10 border border-amber-400/15 text-zinc-200"
                : "bg-white/[0.03] border border-white/[0.06] text-zinc-300"
            }`}>
              {(msg.status === "pending" || msg.status === "running") && !msg.content ? (
                <div className="space-y-1.5">
                  {liveLogs.length === 0 ? (
                    <span className="text-xs font-mono text-zinc-600 animate-pulse">procesando···</span>
                  ) : (
                    <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                      {liveLogs.map((log, li) => (
                        <div key={li} className={`text-[11px] font-mono leading-relaxed ${
                          log.level === "info" ? "text-zinc-500" :
                          log.level === "tool_use" ? "text-yellow-400/80" :
                          log.level === "tool_result" ? "text-cyan-400/80" :
                          "text-red-400"
                        }`}>
                          {log.level === "tool_use" && log.metadata ? (
                            <span>
                              <span className="text-zinc-600 mr-1">→</span>
                              <span className="text-yellow-300/80">{String(log.metadata.tool)}</span>
                              <span className="text-zinc-600 mx-1 text-[10px]">{JSON.stringify(log.metadata.input).slice(0, 100)}</span>
                            </span>
                          ) : log.level === "tool_result" ? (
                            <span>
                              <span className="text-zinc-600 mr-1">←</span>
                              <span className="line-clamp-1">{log.message}</span>
                            </span>
                          ) : (
                            <span className="line-clamp-3 whitespace-pre-wrap">{log.message}</span>
                          )}
                        </div>
                      ))}
                      <span className="text-[11px] font-mono text-zinc-700 animate-pulse block">···</span>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {rawMessages.has(i) ? (
                    <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed text-zinc-300">{msg.content}</pre>
                  ) : (
                    <InfoMessage message={msg.content} />
                  )}
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-zinc-700">
                    {msg.role === "assistant" && msg.status && (
                      <span className={STATUS_TEXT[msg.status]}>{msg.status}</span>
                    )}
                    {msg.role === "assistant" && msg.tokens != null && msg.tokens > 0 && (
                      <span>{fmtTokens(msg.tokens)} tokens</span>
                    )}
                    {msg.role === "assistant" && msg.run_id && (
                      <Link href={`/runs/${msg.run_id}`} className="hover:text-zinc-500 transition-colors">
                        ver run →
                      </Link>
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content).then(() => {
                          setCopiedMsg(i);
                          setTimeout(() => setCopiedMsg((c) => c === i ? null : c), 2000);
                        });
                      }}
                      className="ml-auto flex items-center gap-1.5 transition-colors hover:text-zinc-500"
                    >
                      {copiedMsg === i ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copiedMsg === i ? "copiado" : "copiar"}
                    </button>
                    <button
                      onClick={() => setRawMessages((prev) => {
                        const next = new Set(prev);
                        next.has(i) ? next.delete(i) : next.add(i);
                        return next;
                      })}
                      className={`flex items-center gap-1 transition-colors ${rawMessages.has(i) ? "text-amber-400" : "hover:text-zinc-500"}`}
                    >
                      <Code className="w-3 h-3" />
                      raw
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
          }}
          placeholder="Continúa la conversación… (Enter para enviar, Shift+Enter para nueva línea)"
          rows={2}
          disabled={sending}
          className="flex-1 bg-zinc-900 border border-white/[0.06] rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/20 resize-none font-mono disabled:opacity-50"
        />
        <button
          onClick={sendMessage}
          disabled={sending || !input.trim()}
          className="px-4 self-end py-3 rounded-xl border border-amber-400/20 text-amber-400 hover:text-amber-300 hover:border-amber-400/40 text-xs font-mono transition-all disabled:opacity-30"
        >
          {sending ? "···" : "→"}
        </button>
      </div>
    </div>
  );
}
