"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, KnowledgeAgent, Run, KNOWLEDGE_TOOLS, KNOWLEDGE_TOOL_GROUPS } from "@/lib/api";

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

type View = "chat" | "document" | "conversations" | "config";

interface ConversationSummary {
  convId: string;
  firstMessage: string;
  msgCount: number;
  lastAt: string;
}

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
  docUpdated?: boolean;
}

export default function KnowledgeAgentDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agent, setAgent] = useState<KnowledgeAgent | null>(null);
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // conversationId: stable UUID that identifies this chat thread, lives in ?conv= URL param
  const [conversationId, setConversationId] = useState<string | null>(searchParams.get("conv"));
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // latestSessionId: Claude CLI session_id for --resume, updated after each run, NOT in URL
  const [latestSessionId, setLatestSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [docEdit, setDocEdit] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);
  const [configForm, setConfigForm] = useState({ name: "", description: "", model: "", system_prompt: "" });
  const [savingConfig, setSavingConfig] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingTool, setTogglingTool] = useState<string | null>(null);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const setConversation = (convId: string | null) => {
    setConversationId(convId);
    if (convId) {
      router.replace(`/knowledge-agents/${id}?conv=${convId}`, { scroll: false });
    } else {
      router.replace(`/knowledge-agents/${id}`, { scroll: false });
    }
  };

  const loadAgent = async () => {
    const a = await api.knowledgeAgents.get(id);
    setAgent(a);
    setDocEdit(a.knowledge_doc);
    setConfigForm({ name: a.name, description: a.description, model: a.model, system_prompt: a.system_prompt });
  };

  const loadConversationHistory = async (convId: string) => {
    const allRuns = await api.runs.list({ agent_id: `knowledge:${id}`, limit: 200 });
    const convRuns = allRuns
      .filter((r) => (r.input_params as Record<string, string>).conversation_id === convId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const msgs: ChatMessage[] = [];
    for (const run of convRuns) {
      const userMsg = (run.input_params as Record<string, string>).user_message ?? "";
      msgs.push({ role: "user", content: userMsg });
      msgs.push({
        role: "assistant",
        content: run.status === "success" ? (run.output ?? "") : (run.error ?? "Error desconocido"),
        run_id: run.id,
        status: run.status,
        tokens: (run.tokens_input ?? 0) + (run.tokens_output ?? 0),
      });
    }
    setMessages(msgs);

    // Restore the latest Claude session_id for --resume
    const lastWithSession = [...convRuns].reverse().find((r) => r.session_id);
    if (lastWithSession?.session_id) setLatestSessionId(lastWithSession.session_id);
  };

  const loadConversations = async () => {
    const allRuns = await api.runs.list({ agent_id: `knowledge:${id}`, limit: 200 });
    const groups = new Map<string, Run[]>();
    for (const run of allRuns) {
      const convId = (run.input_params as Record<string, string>).conversation_id;
      if (!convId) continue;
      if (!groups.has(convId)) groups.set(convId, []);
      groups.get(convId)!.push(run);
    }
    const summaries: ConversationSummary[] = [];
    for (const [convId, runs] of groups) {
      const sorted = runs.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const firstMsg = (sorted[0].input_params as Record<string, string>).user_message ?? "";
      summaries.push({
        convId,
        firstMessage: firstMsg,
        msgCount: sorted.length,
        lastAt: sorted[sorted.length - 1].created_at,
      });
    }
    summaries.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
    setConversations(summaries);
  };

  const initialConv = useRef(searchParams.get("conv"));
  useEffect(() => {
    loadAgent();
    if (initialConv.current) loadConversationHistory(initialConv.current);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput("");
    setSending(true);

    // Generate conversation_id on first message
    let convId = conversationId;
    if (!convId) {
      convId = crypto.randomUUID();
      setConversation(convId);
    }

    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    setMessages((m) => [...m, { role: "assistant", content: "", status: "pending" }]);

    try {
      const { run_id } = await api.knowledgeAgents.query(
        id,
        userMsg,
        latestSessionId ?? undefined,
        convId,
      );

      const poll = async () => {
        const run = await api.runs.get(run_id);
        if (run.status === "running" || run.status === "pending") {
          setTimeout(poll, 1500);
          return;
        }

        const updatedAgent = await api.knowledgeAgents.get(id);
        const docUpdated = updatedAgent.knowledge_doc !== agent?.knowledge_doc;
        if (docUpdated) {
          setAgent(updatedAgent);
          setDocEdit(updatedAgent.knowledge_doc);
        }

        if (run.session_id) setLatestSessionId(run.session_id);

        setMessages((m) => {
          const updated = [...m];
          const last = updated[updated.length - 1];
          if (last.role === "assistant") {
            updated[updated.length - 1] = {
              role: "assistant",
              content: run.status === "success" ? (run.output ?? "") : (run.error ?? "Error desconocido"),
              run_id,
              status: run.status,
              tokens: (run.tokens_input ?? 0) + (run.tokens_output ?? 0),
              docUpdated,
            };
          }
          return updated;
        });
        setSending(false);
      };

      poll();
    } catch (err) {
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

  const toggleTool = async (name: string) => {
    if (!agent || togglingTool || name === "Read") return;
    setTogglingTool(name);
    try {
      const current = agent.tools ?? ["Read", "Write"];
      const next = current.includes(name) ? current.filter((t) => t !== name) : [...current, name];
      const updated = await api.knowledgeAgents.update(id, { tools: next });
      setAgent(updated);
    } finally {
      setTogglingTool(null);
    }
  };

  const saveDoc = async () => {
    if (!agent) return;
    setSavingDoc(true);
    try {
      const updated = await api.knowledgeAgents.importDoc(id, docEdit);
      setAgent(updated);
    } finally {
      setSavingDoc(false);
    }
  };

  const exportDoc = async () => {
    if (!agent) return;
    const res = await api.knowledgeAgents.exportDoc(id);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.md`;
    a.click();
  };

  const saveConfig = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!agent) return;
    setSavingConfig(true);
    try {
      const updated = await api.knowledgeAgents.update(id, configForm);
      setAgent(updated);
    } finally {
      setSavingConfig(false);
    }
  };

  const deleteAgent = async () => {
    if (!confirm(`¿Eliminar "${agent?.name}"? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    try {
      await api.knowledgeAgents.delete(id);
      router.push("/knowledge-agents");
    } catch {
      setDeleting(false);
    }
  };

  if (!agent) return <div className="text-zinc-500 text-sm p-8">Cargando…</div>;

  return (
    <div className="flex flex-col h-[calc(100dvh-120px)] gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/knowledge-agents" className="text-xs text-zinc-500 hover:text-zinc-400">
            ← Conocimiento
          </Link>
          <span className="text-zinc-800">·</span>
          <h1 className="text-base font-mono font-semibold text-zinc-200">{agent.name}</h1>
          {agent.description && (
            <span className="text-xs text-zinc-600 hidden sm:block">{agent.description}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView("chat")}
            className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
              view === "chat" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            chat
          </button>
          <button
            onClick={() => setView("document")}
            className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
              view === "document" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            documento {agent.knowledge_doc ? `(${(agent.knowledge_doc.length / 1000).toFixed(1)}k)` : "(vacío)"}
          </button>
          <button
            onClick={() => { setView("conversations"); loadConversations(); }}
            className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
              view === "conversations" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            conversaciones
          </button>
          <button
            onClick={() => setView("config")}
            className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
              view === "config" ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            config
          </button>
        </div>
      </div>

      {/* Chat view */}
      {view === "chat" && (
        <>
          {/* Session + tools bar */}
          <div className="shrink-0 flex items-center justify-between px-1">
            {/* Tools popover */}
            <div className="relative" ref={toolsMenuRef}>
              <button
                onClick={() => setShowToolsMenu((v) => !v)}
                className="flex items-center gap-1.5 group"
              >
                <span className="text-[11px] font-mono text-zinc-800">tools:</span>
                <span className="text-[11px] font-mono text-sky-800">Read</span>
                {(() => {
                  const extra = (agent.tools ?? []).filter((t) => t !== "Read");
                  const shown = extra.slice(0, 2);
                  const rest = extra.length - shown.length;
                  return (
                    <>
                      {shown.map((t) => <span key={t} className="text-[11px] font-mono text-sky-400">{t}</span>)}
                      {rest > 0 && <span className="text-[11px] font-mono text-zinc-600">+{rest}</span>}
                    </>
                  );
                })()}
                <span className="text-[11px] font-mono text-zinc-700 group-hover:text-zinc-500 transition-colors">▾</span>
              </button>

              {showToolsMenu && (
                <div className="absolute top-full left-0 mt-2 z-50 w-[420px] rounded-xl border border-white/[0.08] bg-zinc-950 shadow-xl p-3 space-y-3">
                  {KNOWLEDGE_TOOL_GROUPS.map(({ key, label }) => {
                    const groupTools = KNOWLEDGE_TOOLS.filter((t) => t.group === key);
                    return (
                      <div key={key}>
                        <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-700 mb-1">{label}</p>
                        <div className="space-y-0.5">
                          {groupTools.map(({ name, description }) => {
                            const active = (agent.tools ?? []).includes(name);
                            const always = name === "Read";
                            return (
                              <button
                                key={name}
                                onClick={() => toggleTool(name)}
                                disabled={always || !!togglingTool}
                                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors disabled:cursor-default ${
                                  active ? "hover:bg-sky-400/5" : "hover:bg-white/[0.03]"
                                }`}
                              >
                                <span className={`text-[11px] font-mono w-3 shrink-0 ${active ? "text-sky-400" : "text-zinc-700"}`}>
                                  {togglingTool === name ? "·" : active ? "✓" : "·"}
                                </span>
                                <span className={`text-xs font-mono shrink-0 w-24 ${active ? (always ? "text-sky-800" : "text-sky-400") : "text-zinc-600"}`}>
                                  {name}
                                </span>
                                <span className="text-[11px] text-zinc-700 leading-snug">{description}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {conversationId && (
                <span className="text-[11px] font-mono text-zinc-800">
                  conv {conversationId.slice(0, 8)}…
                </span>
              )}
              <button
                onClick={() => { setMessages([]); setLatestSessionId(null); setConversation(null); }}
                disabled={sending}
                className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-30"
              >
                nueva conversación ↺
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/[0.06] p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-xs font-mono text-zinc-700">
                    {conversationId
                      ? `Retomando conversación ${conversationId.slice(0, 8)}… — escribe para continuar`
                      : agent.knowledge_doc
                        ? `Consulta a ${agent.name} — responderá con el contexto de su base de conocimiento`
                        : "Este agente aún no tiene base de conocimiento. Ve al panel «documento» para añadirla."}
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "bg-amber-400/10 border border-amber-400/15 text-zinc-200"
                      : "bg-white/[0.03] border border-white/[0.06] text-zinc-300"
                  }`}
                >
                  {msg.status === "pending" || (msg.status === "running" && !msg.content) ? (
                    <span className="text-xs font-mono text-zinc-600 animate-pulse">procesando···</span>
                  ) : (
                    <>
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{msg.content}</pre>
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-zinc-700">
                          {msg.status && (
                            <span className={STATUS_TEXT[msg.status]}>{msg.status}</span>
                          )}
                          {msg.tokens && msg.tokens > 0 && (
                            <span>{(msg.tokens / 1000).toFixed(1)}k tokens</span>
                          )}
                          {msg.docUpdated && (
                            <span className="text-amber-400/60">↗ doc actualizado</span>
                          )}
                          {msg.run_id && (
                            <Link
                              href={`/runs/${msg.run_id}`}
                              className="hover:text-zinc-500 transition-colors"
                            >
                              ver run →
                            </Link>
                          )}
                        </div>
                      )}
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
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Escribe tu consulta… (Enter para enviar, Shift+Enter para nueva línea)"
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
        </>
      )}

      {/* Conversations view */}
      {view === "conversations" && (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
          {conversations.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs font-mono text-zinc-700">sin conversaciones anteriores</p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div key={conv.convId} className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.02] transition-colors group">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-300 truncate">{conv.firstMessage}</p>
                  <p className="text-[11px] font-mono text-zinc-700 mt-0.5">
                    conv {conv.convId.slice(0, 8)}… · {conv.msgCount} {conv.msgCount === 1 ? "mensaje" : "mensajes"} · {asUTC(conv.lastAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setMessages([]);
                    setLatestSessionId(null);
                    setConversation(conv.convId);
                    loadConversationHistory(conv.convId);
                    setView("chat");
                  }}
                  className="text-xs font-mono text-zinc-600 hover:text-amber-400 transition-colors shrink-0"
                >
                  retomar →
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Document view */}
      {view === "document" && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-center justify-between shrink-0">
            <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">
              {agent.knowledge_doc
                ? `${(agent.knowledge_doc.length / 1000).toFixed(1)}k chars · actualizado ${asUTC(agent.updated_at).toLocaleDateString("es-ES")}`
                : "documento vacío"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={exportDoc}
                className="text-xs font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1"
              >
                exportar .md
              </button>
              <button
                onClick={saveDoc}
                disabled={savingDoc || docEdit === agent.knowledge_doc}
                className="text-xs font-mono text-amber-400 hover:text-amber-300 px-3 py-1 border border-amber-400/20 hover:border-amber-400/40 rounded-md transition-all disabled:opacity-30"
              >
                {savingDoc ? "guardando···" : "guardar"}
              </button>
            </div>
          </div>
          <textarea
            value={docEdit}
            onChange={(e) => setDocEdit(e.target.value)}
            placeholder="# Base de conocimiento\n\nEscribe aquí el documento en Markdown…"
            className="flex-1 min-h-0 bg-zinc-900 border border-white/[0.06] rounded-xl px-4 py-4 text-sm text-zinc-300 font-mono leading-relaxed focus:outline-none focus:border-amber-400/20 resize-none placeholder-zinc-800"
          />
        </div>
      )}

      {/* Config view */}
      {view === "config" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <form onSubmit={saveConfig} className="space-y-5 max-w-lg">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Nombre</label>
              <input
                value={configForm.name}
                onChange={(e) => setConfigForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Descripción</label>
              <input
                value={configForm.description}
                onChange={(e) => setConfigForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Modelo</label>
              <select
                value={configForm.model}
                onChange={(e) => setConfigForm((f) => ({ ...f, model: e.target.value }))}
                className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-amber-400/30"
              >
                <option value="claude-sonnet-4-6">Sonnet 4.6</option>
                <option value="claude-opus-4-7">Opus 4.7</option>
                <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
              </select>
            </div>
            <div className="space-y-3">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Tools</label>
              {KNOWLEDGE_TOOL_GROUPS.map(({ key, label }) => {
                const groupTools = KNOWLEDGE_TOOLS.filter((t) => t.group === key);
                return (
                  <div key={key}>
                    <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-700 mb-1.5">{label}</p>
                    <div className="space-y-0.5">
                      {groupTools.map(({ name, description }) => {
                        const active = (agent.tools ?? []).includes(name);
                        const always = name === "Read";
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleTool(name)}
                            disabled={always || !!togglingTool}
                            className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors disabled:cursor-default ${
                              active ? "bg-sky-400/5 hover:bg-sky-400/8" : "hover:bg-white/[0.03]"
                            }`}
                          >
                            <span className={`text-[11px] font-mono w-3 shrink-0 ${active ? "text-sky-400" : "text-zinc-700"}`}>
                              {togglingTool === name ? "·" : active ? "✓" : "·"}
                            </span>
                            <span className={`text-xs font-mono shrink-0 w-24 ${active ? (always ? "text-sky-800" : "text-sky-400") : "text-zinc-600"}`}>
                              {name}
                            </span>
                            <span className="text-[11px] text-zinc-700 leading-snug">{description}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">System prompt</label>
              <textarea
                value={configForm.system_prompt}
                onChange={(e) => setConfigForm((f) => ({ ...f, system_prompt: e.target.value }))}
                rows={8}
                placeholder="Instrucciones adicionales para el agente…"
                className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2.5 text-sm text-zinc-300 font-mono leading-relaxed placeholder-zinc-800 focus:outline-none focus:border-amber-400/30 resize-none"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={deleteAgent}
                disabled={deleting}
                className="text-xs font-mono text-red-500/60 hover:text-red-400 transition-colors disabled:opacity-30"
              >
                {deleting ? "eliminando···" : "eliminar agente"}
              </button>
              <button
                type="submit"
                disabled={savingConfig}
                className="text-xs font-mono text-amber-400 hover:text-amber-300 px-4 py-1.5 border border-amber-400/20 hover:border-amber-400/40 rounded-md transition-all disabled:opacity-40"
              >
                {savingConfig ? "guardando···" : "guardar cambios →"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
