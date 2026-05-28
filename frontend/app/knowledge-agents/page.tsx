"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, KnowledgeAgent } from "@/lib/api";

const MODELS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-7", label: "Opus 4.7" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

export default function KnowledgeAgentsList() {
  const [agents, setAgents] = useState<KnowledgeAgent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", description: "", model: "claude-sonnet-4-6" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.knowledgeAgents.list().then(setAgents);

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.id || !form.name) return;
    setCreating(true);
    setError("");
    try {
      await api.knowledgeAgents.create(form);
      setShowForm(false);
      setForm({ id: "", name: "", description: "", model: "claude-sonnet-4-6" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear agente");
    } finally {
      setCreating(false);
    }
  };

  const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight">Bases de conocimiento</h1>
          <p className="text-xs text-zinc-600 mt-0.5">Agentes con contexto destilado y documento actualizable</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs font-mono text-amber-400 hover:text-amber-300 px-3 py-1.5 border border-amber-400/20 hover:border-amber-400/40 rounded-md transition-all"
        >
          {showForm ? "cancelar" : "+ nuevo agente"}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">ID (slug)</label>
              <input
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
                placeholder="homelab"
                className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Nombre</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Mi Homelab"
                className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Descripción</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Documentación de mi infraestructura doméstica"
              className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Modelo</label>
            <select
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              className="bg-zinc-900 border border-white/[0.06] rounded-lg text-sm text-zinc-300 px-3 py-2 focus:outline-none focus:border-amber-400/30 w-full"
            >
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-red-400 font-mono">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating || !form.id || !form.name}
              className="text-xs font-mono text-amber-400 hover:text-amber-300 px-4 py-1.5 border border-amber-400/20 hover:border-amber-400/40 rounded-md transition-all disabled:opacity-40"
            >
              {creating ? "creando···" : "crear agente →"}
            </button>
          </div>
        </form>
      )}

      {agents.length === 0 && !showForm ? (
        <div className="rounded-xl border border-white/[0.06] px-4 py-16 text-center">
          <p className="text-xs font-mono text-zinc-700">— sin bases de conocimiento —</p>
          <p className="text-xs text-zinc-700 mt-1">Crea la primera con el botón de arriba</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Link
              key={agent.id}
              href={`/knowledge-agents/${agent.id}`}
              className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 hover:bg-white/[0.03] hover:border-white/[0.1] transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-mono font-medium text-zinc-200 group-hover:text-zinc-100 truncate">{agent.name}</p>
                  <p className="text-[11px] font-mono text-zinc-700 mt-0.5">{agent.id}</p>
                </div>
                <span className="text-amber-400/40 group-hover:text-amber-400/80 transition-colors text-xs font-mono shrink-0 ml-2">→</span>
              </div>
              {agent.description && (
                <p className="text-xs text-zinc-600 leading-relaxed mb-3 line-clamp-2">{agent.description}</p>
              )}
              <div className="flex items-center justify-between text-[11px] font-mono text-zinc-700">
                <span>{agent.model.split("-").slice(-2).join("-")}</span>
                <span>{agent.knowledge_doc ? `${(agent.knowledge_doc.length / 1000).toFixed(1)}k chars` : "sin doc"}</span>
              </div>
              <div className="mt-2 text-[11px] font-mono text-zinc-800">
                actualizado {asUTC(agent.updated_at).toLocaleDateString("es-ES")}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
