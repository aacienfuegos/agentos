"use client";

import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, KnowledgeAgent, Run } from "@/lib/api";

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

type View = "chat" | "document";


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
  const [agent, setAgent] = useState<KnowledgeAgent | null>(null);
  const [view, setView] = useState<View>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [docEdit, setDocEdit] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadAgent = async () => {
    const a = await api.knowledgeAgents.get(id);
    setAgent(a);
    setDocEdit(a.knowledge_doc);
  };

  useEffect(() => { loadAgent(); }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMsg = input.trim();
    setInput("");
    setSending(true);

    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    setMessages((m) => [...m, { role: "assistant", content: "", status: "pending" }]);

    try {
      const { run_id } = await api.knowledgeAgents.query(id, userMsg);

      // Poll the run until done
      const poll = async () => {
        const run = await api.runs.get(run_id);
        if (run.status === "running" || run.status === "pending") {
          setTimeout(poll, 1500);
          return;
        }

        // Reload agent to get updated knowledge_doc
        const updatedAgent = await api.knowledgeAgents.get(id);
        const docUpdated = updatedAgent.knowledge_doc !== agent?.knowledge_doc;
        if (docUpdated) {
          setAgent(updatedAgent);
          setDocEdit(updatedAgent.knowledge_doc);
        }

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
        </div>
      </div>

      {/* Chat view */}
      {view === "chat" && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/[0.06] p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-xs font-mono text-zinc-700">
                    {agent.knowledge_doc
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
    </div>
  );
}
