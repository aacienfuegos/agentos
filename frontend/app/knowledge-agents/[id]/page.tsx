"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, KnowledgeAgent, KnowledgeFile, Run, KNOWLEDGE_TOOLS, KNOWLEDGE_TOOL_GROUPS } from "@/lib/api";

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

type View = "chat" | "archivos" | "conversations" | "config";

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
}

interface LiveLogEvent {
  level: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// File browser helpers
// ---------------------------------------------------------------------------

function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: KnowledgeFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const renderEntries = (parentPath: string, depth: number): React.ReactNode => {
    const entries = files.filter((f) => {
      const parts = f.path.split("/");
      const parent = parts.slice(0, -1).join("/");
      return parent === parentPath;
    });
    entries.sort((a, b) => {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    return entries.map((f) => {
      const name = f.path.split("/").at(-1)!;
      const indent = depth * 12;
      if (f.is_dir) {
        return (
          <div key={f.path}>
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono text-zinc-600"
              style={{ paddingLeft: `${8 + indent}px` }}
            >
              <span>▸</span>
              <span>{name}/</span>
            </div>
            {renderEntries(f.path, depth + 1)}
          </div>
        );
      }
      return (
        <button
          key={f.path}
          onClick={() => onSelect(f.path)}
          className={`w-full flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono text-left transition-colors rounded ${
            selected === f.path
              ? "bg-amber-400/10 text-amber-300"
              : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.03]"
          }`}
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          <span className="text-zinc-700">·</span>
          <span className="truncate">{name}</span>
          {f.size != null && (
            <span className="ml-auto text-zinc-800 shrink-0">{f.size < 1024 ? `${f.size}b` : `${(f.size / 1024).toFixed(1)}k`}</span>
          )}
        </button>
      );
    });
  };

  return <div className="space-y-0">{renderEntries("", 0)}</div>;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function KnowledgeAgentDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agent, setAgent] = useState<KnowledgeAgent | null>(null);
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(searchParams.get("conv"));
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [latestSessionId, setLatestSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // File browser state
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [editingContent, setEditingContent] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [deletingFile, setDeletingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ written: string[]; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Config state
  const [configForm, setConfigForm] = useState({
    name: "", description: "", model: "", system_prompt: "", knowledge_path: "", tools: [] as string[],
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [savedConfig, setSavedConfig] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Tools state
  const [chatTools, setChatTools] = useState<string[]>([]);
  const [savingDefaultTools, setSavingDefaultTools] = useState(false);
  const [savedDefaultTools, setSavedDefaultTools] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LiveLogEvent[]>([]);
  const liveEsRef = useRef<EventSource | null>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

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
    setConfigForm({
      name: a.name, description: a.description, model: a.model,
      system_prompt: a.system_prompt, knowledge_path: a.knowledge_path,
      tools: a.tools ?? ["Read", "Write"],
    });
    setChatTools(a.tools ?? ["Read", "Write"]);
  };

  const loadFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const list = await api.knowledgeAgents.files.list(id);
      setFiles(list);
    } finally {
      setLoadingFiles(false);
    }
  }, [id]);

  const selectFile = async (path: string) => {
    setSelectedFile(path);
    setLoadingFile(true);
    try {
      const content = await api.knowledgeAgents.files.get(id, path);
      setFileContent(content);
      setEditingContent(content);
    } catch {
      setFileContent("");
      setEditingContent("");
    } finally {
      setLoadingFile(false);
    }
  };

  const saveFile = async () => {
    if (!selectedFile) return;
    setSavingFile(true);
    try {
      await api.knowledgeAgents.files.update(id, selectedFile, editingContent);
      setFileContent(editingContent);
      await loadFiles();
    } finally {
      setSavingFile(false);
    }
  };

  const deleteFile = async () => {
    if (!selectedFile || !confirm(`¿Eliminar "${selectedFile}"?`)) return;
    setDeletingFile(true);
    try {
      await api.knowledgeAgents.files.delete(id, selectedFile);
      setSelectedFile(null);
      setFileContent("");
      setEditingContent("");
      await loadFiles();
    } finally {
      setDeletingFile(false);
    }
  };

  const createFile = async () => {
    if (!newFilePath.trim()) return;
    await api.knowledgeAgents.files.update(id, newFilePath.trim(), "");
    setShowNewFile(false);
    setNewFilePath("");
    await loadFiles();
    selectFile(newFilePath.trim());
  };

  const handleUpload = useCallback(async (inputFiles: FileList | File[]) => {
    const arr = Array.from(inputFiles);
    if (!arr.length) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const result = await api.knowledgeAgents.files.upload(id, arr);
      setUploadResult(result);
      await loadFiles();
      // Auto-select first written file if nothing selected
      if (!selectedFile && result.written.length > 0) {
        selectFile(result.written[0]);
      }
    } catch (err) {
      setUploadResult({ written: [], errors: [err instanceof Error ? err.message : "Error desconocido"] });
    } finally {
      setUploading(false);
    }
  }, [id, selectedFile, loadFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const loadConversationHistory = async (convId: string) => {
    const allRuns = await api.runs.list({ agent_id: `knowledge:${id}`, limit: 200 });
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
      summaries.push({
        convId,
        firstMessage: (sorted[0].input_params as Record<string, string>).user_message ?? "",
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
    if (view === "archivos") loadFiles();
  }, [view, loadFiles]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveLogs]);

  useEffect(() => {
    return () => { liveEsRef.current?.close(); };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const finalizeRun = async (run_id: string) => {
    liveEsRef.current?.close();
    liveEsRef.current = null;
    const run = await api.runs.get(run_id);
    if (run.session_id) setLatestSessionId(run.session_id);
    setLiveLogs([]);
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
        };
      }
      return updated;
    });
    setSending(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput("");
    setSending(true);
    setLiveLogs([]);

    let convId = conversationId;
    if (!convId) {
      convId = crypto.randomUUID();
      setConversation(convId);
    }

    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    setMessages((m) => [...m, { role: "assistant", content: "", status: "pending" }]);

    try {
      const agentDefaultTools = agent?.tools ?? ["Read", "Write"];
      const toolsOverride =
        chatTools.length !== agentDefaultTools.length || chatTools.some((t) => !agentDefaultTools.includes(t))
          ? chatTools
          : undefined;

      const { run_id } = await api.knowledgeAgents.query(id, userMsg, latestSessionId ?? undefined, convId, toolsOverride);

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
          const event: LiveLogEvent = JSON.parse(e.data);
          if (["info", "tool_use", "tool_result", "error"].includes(event.level)) {
            setLiveLogs((prev) => [...prev, event]);
          }
          if (event.level === "done" || event.level === "error") finish();
        } catch { /* ignore */ }
      };

      es.addEventListener("done", finish);

      es.onerror = () => {
        es.close();
        finish();
      };
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

  const toggleChatTool = (name: string) => {
    if (name === "Read") return;
    setChatTools((prev) => prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name]);
  };

  const saveDefaultTools = async () => {
    if (!agent) return;
    setSavingDefaultTools(true);
    try {
      const updated = await api.knowledgeAgents.update(id, { tools: chatTools });
      setAgent(updated);
      setConfigForm((f) => ({ ...f, tools: updated.tools ?? ["Read", "Write"] }));
      setSavedDefaultTools(true);
      setTimeout(() => setSavedDefaultTools(false), 2000);
    } finally {
      setSavingDefaultTools(false);
    }
  };

  const saveConfig = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!agent) return;
    setSavingConfig(true);
    try {
      const updated = await api.knowledgeAgents.update(id, configForm);
      setAgent(updated);
      setSavedConfig(true);
      setTimeout(() => setSavedConfig(false), 2000);
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

  const agentTools = agent.tools ?? ["Read", "Write"];
  const configDirty =
    configForm.name !== agent.name ||
    configForm.description !== agent.description ||
    configForm.model !== agent.model ||
    configForm.system_prompt !== agent.system_prompt ||
    configForm.knowledge_path !== agent.knowledge_path ||
    configForm.tools.length !== agentTools.length ||
    configForm.tools.some((t) => !agentTools.includes(t));

  const fileDirty = editingContent !== fileContent;

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
          {(["chat", "archivos", "conversations", "config"] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => { setView(v); if (v === "conversations") loadConversations(); }}
              className={`px-2.5 py-1 rounded-md text-xs font-mono transition-colors ${
                view === v ? "bg-white/[0.08] text-zinc-200" : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Chat view                                                            */}
      {/* ------------------------------------------------------------------ */}
      {view === "chat" && (
        <>
          <div className="shrink-0 flex items-center justify-between px-1">
            {/* Tools popover */}
            <div className="relative" ref={toolsMenuRef}>
              <button onClick={() => setShowToolsMenu((v) => !v)} className="flex items-center gap-1.5 group">
                <span className="text-[11px] font-mono text-zinc-800">tools:</span>
                <span className="text-[11px] font-mono text-sky-800">Read</span>
                {(() => {
                  const extra = chatTools.filter((t) => t !== "Read");
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
                            const active = chatTools.includes(name);
                            const always = name === "Read";
                            return (
                              <button
                                key={name}
                                onClick={() => toggleChatTool(name)}
                                disabled={always}
                                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors disabled:cursor-default ${
                                  active ? "hover:bg-sky-400/5" : "hover:bg-white/[0.03]"
                                }`}
                              >
                                <span className={`text-[11px] font-mono w-3 shrink-0 ${active ? "text-sky-400" : "text-zinc-700"}`}>
                                  {active ? "✓" : "·"}
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
                  <div className="pt-3 mt-1 border-t border-white/[0.06] space-y-2.5">
                    <p className="text-[11px] font-mono text-zinc-700">cambios solo para esta conversación</p>
                    <div className="flex items-center justify-between">
                      {(chatTools.length !== agentTools.length || chatTools.some((t) => !agentTools.includes(t))) ? (
                        <button onClick={() => setChatTools(agentTools)} className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors">
                          ↺ restaurar defecto
                        </button>
                      ) : <span />}
                      <button
                        onClick={saveDefaultTools}
                        disabled={savingDefaultTools || savedDefaultTools || (chatTools.length === agentTools.length && chatTools.every((t) => agentTools.includes(t)))}
                        className="text-[11px] font-mono text-amber-400/70 hover:text-amber-400 transition-colors disabled:opacity-40"
                      >
                        {savingDefaultTools ? "guardando···" : savedDefaultTools ? "guardado ✓" : "guardar como defecto →"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              {conversationId && (
                <span className="text-[11px] font-mono text-zinc-800">conv {conversationId.slice(0, 8)}…</span>
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
                <p className="text-xs font-mono text-zinc-700">
                  {conversationId
                    ? `Retomando conversación ${conversationId.slice(0, 8)}… — escribe para continuar`
                    : `Consulta a ${agent.name} — responderá con el contexto de su base de conocimiento`}
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-amber-400/10 border border-amber-400/15 text-zinc-200"
                    : "bg-white/[0.03] border border-white/[0.06] text-zinc-300"
                }`}>
                  {msg.status === "pending" || (msg.status === "running" && !msg.content) ? (
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
                      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{msg.content}</pre>
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/[0.04] text-[11px] font-mono text-zinc-700">
                          {msg.status && <span className={STATUS_TEXT[msg.status]}>{msg.status}</span>}
                          {msg.tokens != null && msg.tokens > 0 && <span>{(msg.tokens / 1000).toFixed(1)}k tokens</span>}
                          {msg.run_id && (
                            <Link href={`/runs/${msg.run_id}`} className="hover:text-zinc-500 transition-colors">
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

          <div className="shrink-0 flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
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

      {/* ------------------------------------------------------------------ */}
      {/* Archivos view                                                        */}
      {/* ------------------------------------------------------------------ */}
      {view === "archivos" && (
        <>
          {/* Hidden file inputs */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error webkitdirectory is not in the standard types
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleUpload(e.target.files)}
          />

          <div
            className={`flex-1 min-h-0 flex gap-3 transition-colors rounded-xl ${dragOver ? "ring-1 ring-amber-400/30 bg-amber-400/[0.02]" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {/* File list panel */}
            <div className="w-52 shrink-0 flex flex-col gap-2 min-h-0">
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-700 truncate" title={agent.knowledge_path}>
                  {agent.knowledge_path.replace(/^\/data\/knowledge\//, "~/")}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Upload menu */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="text-[11px] font-mono text-zinc-600 hover:text-amber-400 transition-colors disabled:opacity-40"
                    title="Subir ficheros o zip"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => folderInputRef.current?.click()}
                    disabled={uploading}
                    className="text-[11px] font-mono text-zinc-600 hover:text-amber-400 transition-colors disabled:opacity-40"
                    title="Subir carpeta"
                  >
                    ⊞
                  </button>
                  <button
                    onClick={() => setShowNewFile((v) => !v)}
                    className="text-[11px] font-mono text-zinc-600 hover:text-amber-400 transition-colors"
                    title="Nuevo fichero"
                  >
                    +
                  </button>
                </div>
              </div>

              {showNewFile && (
                <div className="flex gap-1 shrink-0">
                  <input
                    value={newFilePath}
                    onChange={(e) => setNewFilePath(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") createFile(); if (e.key === "Escape") setShowNewFile(false); }}
                    placeholder="ruta/fichero.md"
                    autoFocus
                    className="flex-1 min-w-0 bg-zinc-900 border border-white/[0.06] rounded px-2 py-1 text-[11px] font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
                  />
                  <button onClick={createFile} className="text-[11px] font-mono text-amber-400 hover:text-amber-300 px-1">↵</button>
                </div>
              )}

              {/* Upload feedback */}
              {uploading && (
                <p className="text-[11px] font-mono text-amber-400/70 animate-pulse shrink-0">subiendo···</p>
              )}
              {uploadResult && !uploading && (
                <div className="shrink-0 space-y-0.5">
                  {uploadResult.written.length > 0 && (
                    <p className="text-[11px] font-mono text-emerald-400/70">
                      ✓ {uploadResult.written.length} fichero{uploadResult.written.length !== 1 ? "s" : ""}
                    </p>
                  )}
                  {uploadResult.errors.map((e, i) => (
                    <p key={i} className="text-[11px] font-mono text-red-400/70 truncate" title={e}>✗ {e}</p>
                  ))}
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-white/[0.04] py-1">
                {loadingFiles ? (
                  <p className="text-[11px] font-mono text-zinc-700 px-2 py-1">cargando…</p>
                ) : files.length === 0 ? (
                  <div className="px-2 py-4 text-center space-y-1">
                    <p className="text-[11px] font-mono text-zinc-700">sin ficheros</p>
                    <p className="text-[10px] text-zinc-800">arrastra aquí o usa ↑</p>
                  </div>
                ) : (
                  <FileTree files={files} selected={selectedFile} onSelect={selectFile} />
                )}
              </div>

              <button
                onClick={loadFiles}
                className="shrink-0 text-[11px] font-mono text-zinc-700 hover:text-zinc-500 transition-colors text-left"
              >
                ↺ actualizar
              </button>
            </div>

            {/* Editor panel */}
            <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
              {selectedFile ? (
                <>
                  <div className="flex items-center justify-between shrink-0">
                    <span className="text-[11px] font-mono text-zinc-500">{selectedFile}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={deleteFile}
                        disabled={deletingFile}
                        className="text-[11px] font-mono text-red-500/50 hover:text-red-400 transition-colors disabled:opacity-30"
                      >
                        {deletingFile ? "eliminando···" : "eliminar"}
                      </button>
                      <button
                        onClick={saveFile}
                        disabled={savingFile || !fileDirty}
                        className="text-xs font-mono text-amber-400 hover:text-amber-300 px-3 py-1 border border-amber-400/20 hover:border-amber-400/40 rounded-md transition-all disabled:opacity-30"
                      >
                        {savingFile ? "guardando···" : "guardar"}
                      </button>
                    </div>
                  </div>
                  {loadingFile ? (
                    <div className="flex-1 flex items-center justify-center">
                      <span className="text-xs font-mono text-zinc-600 animate-pulse">cargando…</span>
                    </div>
                  ) : (
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="flex-1 min-h-0 bg-zinc-900 border border-white/[0.06] rounded-xl px-4 py-4 text-sm text-zinc-300 font-mono leading-relaxed focus:outline-none focus:border-amber-400/20 resize-none"
                    />
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  {dragOver ? (
                    <p className="text-xs font-mono text-amber-400/70">suelta para subir</p>
                  ) : (
                    <>
                      <p className="text-xs font-mono text-zinc-700">selecciona un fichero para editarlo</p>
                      <p className="text-[11px] font-mono text-zinc-800">o arrastra ficheros / carpetas / zip aquí</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Conversations view                                                   */}
      {/* ------------------------------------------------------------------ */}
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
                  onClick={() => { setMessages([]); setLatestSessionId(null); setConversation(conv.convId); loadConversationHistory(conv.convId); setView("chat"); }}
                  className="text-xs font-mono text-zinc-600 hover:text-amber-400 transition-colors shrink-0"
                >
                  retomar →
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Config view                                                          */}
      {/* ------------------------------------------------------------------ */}
      {view === "config" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <form onSubmit={saveConfig} className="flex flex-col gap-5">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex-1 min-w-0 space-y-5">
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
                  <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Ruta de conocimiento</label>
                  <input
                    value={configForm.knowledge_path}
                    onChange={(e) => setConfigForm((f) => ({ ...f, knowledge_path: e.target.value }))}
                    className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
                  />
                  <p className="text-[11px] text-zinc-700">
                    Ruta dentro del contenedor. Cambia solo si quieres apuntar a un volumen externo.
                  </p>
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
              </div>

              <div className="lg:w-72 shrink-0 space-y-3">
                <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Tools</label>
                {KNOWLEDGE_TOOL_GROUPS.map(({ key, label }) => {
                  const groupTools = KNOWLEDGE_TOOLS.filter((t) => t.group === key);
                  return (
                    <div key={key}>
                      <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-700 mb-1.5">{label}</p>
                      <div className="space-y-0.5">
                        {groupTools.map(({ name, description }) => {
                          const active = configForm.tools.includes(name);
                          const always = name === "Read";
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => {
                                if (always) return;
                                setConfigForm((f) => ({
                                  ...f,
                                  tools: f.tools.includes(name) ? f.tools.filter((t) => t !== name) : [...f.tools, name],
                                }));
                              }}
                              disabled={always}
                              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors disabled:cursor-default ${
                                active ? "bg-sky-400/5 hover:bg-sky-400/8" : "hover:bg-white/[0.03]"
                              }`}
                            >
                              <span className={`text-[11px] font-mono w-3 shrink-0 ${active ? "text-sky-400" : "text-zinc-700"}`}>
                                {active ? "✓" : "·"}
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
                disabled={savingConfig || !configDirty}
                className="text-xs font-mono px-4 py-1.5 border rounded-md transition-all disabled:opacity-40 disabled:cursor-default text-amber-400 hover:text-amber-300 border-amber-400/20 hover:border-amber-400/40 enabled:hover:border-amber-400/40"
              >
                {savingConfig ? "guardando···" : savedConfig ? "guardado ✓" : "guardar cambios →"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
