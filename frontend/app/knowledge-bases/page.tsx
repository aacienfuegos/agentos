"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, KnowledgeBase } from "@/lib/api";

const INSTRUCTION_FLAGS = [
  { key: "cite_verbatim", label: "Citar textualmente" },
  { key: "no_recommendations", label: "Sin recomendaciones" },
  { key: "require_source_refs", label: "Referenciar fuente" },
  { key: "readonly", label: "Solo lectura" },
] as const;

const DEFAULT_INSTRUCTIONS = {
  cite_verbatim: false,
  no_recommendations: false,
  require_source_refs: false,
  readonly: false,
  free_text: "",
};

type Instructions = typeof DEFAULT_INSTRUCTIONS;

export default function KnowledgeBasesList() {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    knowledge_path: "",
    instructions: { ...DEFAULT_INSTRUCTIONS },
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.knowledgeBases.list().then(setBases);

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.id || !form.name) return;
    setCreating(true);
    setError("");
    try {
      await api.knowledgeBases.create({
        id: form.id,
        name: form.name,
        description: form.description,
        knowledge_path: form.knowledge_path,
        instructions: form.instructions,
      });
      setShowForm(false);
      setForm({ id: "", name: "", description: "", knowledge_path: "", instructions: { ...DEFAULT_INSTRUCTIONS } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear base de conocimiento");
    } finally {
      setCreating(false);
    }
  };

  const toggleFlag = (key: keyof Omit<Instructions, "free_text">) => {
    setForm((f) => ({ ...f, instructions: { ...f.instructions, [key]: !f.instructions[key] } }));
  };

  const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight">Bases de conocimiento</h1>
          <p className="text-xs text-zinc-600 mt-0.5">Directorios de ficheros con instrucciones para el agente</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-xs font-mono text-amber-400 hover:text-amber-300 px-3 py-1.5 border border-amber-400/20 hover:border-amber-400/40 rounded-md transition-all"
        >
          {showForm ? "cancelar" : "+ nueva base"}
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
            <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">
              Ruta de conocimiento{" "}
              <span className="normal-case tracking-normal text-zinc-700">(vacío = auto-gestionada)</span>
            </label>
            <input
              value={form.knowledge_path}
              onChange={(e) => setForm((f) => ({ ...f, knowledge_path: e.target.value }))}
              placeholder="/knowledge/homelab"
              className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono placeholder-zinc-700 focus:outline-none focus:border-amber-400/30"
            />
            <p className="text-[11px] text-zinc-700">
              Ruta dentro del contenedor. Déjalo vacío para usar <code className="font-mono">/data/knowledge/{"{id}"}</code>.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Instrucciones</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {INSTRUCTION_FLAGS.map(({ key, label }) => {
                const active = form.instructions[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleFlag(key)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${
                      active ? "border-teal-400/20 bg-teal-400/5" : "border-white/[0.04] hover:border-white/[0.08]"
                    }`}
                  >
                    <span className={`text-xs font-mono shrink-0 w-4 ${active ? "text-teal-400" : "text-zinc-700"}`}>
                      {active ? "✓" : "·"}
                    </span>
                    <span className={`text-xs font-mono ${active ? "text-teal-400" : "text-zinc-600"}`}>{label}</span>
                  </button>
                );
              })}
            </div>
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-mono uppercase tracking-widest text-zinc-600">Instrucciones libres</label>
              <textarea
                value={form.instructions.free_text}
                onChange={(e) => setForm((f) => ({ ...f, instructions: { ...f.instructions, free_text: e.target.value } }))}
                placeholder="Instrucciones adicionales para el agente…"
                rows={3}
                className="w-full bg-zinc-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/30 resize-none"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-400 font-mono">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={creating || !form.id || !form.name}
              className="text-xs font-mono text-amber-400 hover:text-amber-300 px-4 py-1.5 border border-amber-400/20 hover:border-amber-400/40 rounded-md transition-all disabled:opacity-40"
            >
              {creating ? "creando···" : "crear base →"}
            </button>
          </div>
        </form>
      )}

      {bases.length === 0 && !showForm ? (
        <div className="rounded-xl border border-white/[0.06] px-4 py-16 text-center">
          <p className="text-xs font-mono text-zinc-700">— sin bases de conocimiento —</p>
          <p className="text-xs text-zinc-700 mt-1">Crea la primera con el botón de arriba</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bases.map((kb) => {
            const instructions = kb.instructions as Partial<Instructions>;
            const activeFlags = INSTRUCTION_FLAGS.filter(({ key }) => instructions[key]);
            return (
              <Link
                key={kb.id}
                href={`/knowledge-bases/${kb.id}`}
                className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 hover:bg-white/[0.03] hover:border-white/[0.1] transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-medium text-zinc-200 group-hover:text-zinc-100 truncate">{kb.name}</p>
                    <p className="text-[11px] font-mono text-zinc-700 mt-0.5">{kb.id}</p>
                  </div>
                  <span className="text-amber-400/40 group-hover:text-amber-400/80 transition-colors text-xs font-mono shrink-0 ml-2">→</span>
                </div>
                {kb.description && (
                  <p className="text-xs text-zinc-600 leading-relaxed mb-3 line-clamp-2">{kb.description}</p>
                )}
                <div className="text-[11px] font-mono text-zinc-700 mb-2 truncate" title={kb.knowledge_path}>
                  {kb.knowledge_path
                    ? kb.knowledge_path.replace(/^\/data\/knowledge\//, "~/")
                    : "ruta auto"}
                </div>
                {activeFlags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {activeFlags.map(({ key, label }) => (
                      <span key={key} className="text-[10px] font-mono text-teal-500/70 border border-teal-500/15 rounded px-1.5 py-0.5">
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-[11px] font-mono text-zinc-800">
                  actualizado {asUTC(kb.updated_at).toLocaleDateString("es-ES")}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
