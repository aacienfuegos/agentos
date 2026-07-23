"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  HarnessComponentDetail,
  HarnessComponentSummary,
  HarnessComponentType,
  HarnessListResponse,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPES: { key: HarnessComponentType; label: string; singleton?: boolean }[] = [
  { key: "claude_md", label: "CLAUDE.md", singleton: true },
  { key: "rule", label: "Rules" },
  { key: "agent", label: "Agents" },
  { key: "skill", label: "Skills" },
  { key: "context", label: "Contexts" },
  { key: "script", label: "Scripts" },
];

const AGENT_MODELS = [
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

const AVAILABLE_TOOLS = [
  "Read", "Write", "Edit", "Glob", "Grep", "LS",
  "Bash", "WebFetch", "WebSearch", "Task",
];

const GENERATE_TYPES: HarnessComponentType[] = ["agent", "skill", "rule", "context", "script"];

const PLACEHOLDERS: Partial<Record<HarnessComponentType, string>> = {
  rule: "# Mi regla\n\n## Principios\n\n- ...",
  agent: "---\nname: mi-agente\ndescription: Descripción del agente\nmodel: claude-sonnet-4-6\ntools:\n  - Read\n  - Bash\n---\n\nInstrucciones del agente aquí.",
  skill: "---\nname: mi-skill\ndescription: Descripción de la skill\nmetadata:\n  type: skill\n---\n\n# Mi Skill\n\n## Cuándo usar\n\n## Instrucciones",
  context: "# Contexto\n\nInformación de contexto aquí.",
  script: "#!/usr/bin/env bash\nset -euo pipefail\n\n# Script description\n",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function parseAgentFrontmatter(content: string): {
  fm: { name?: string; description?: string; model?: string; tools?: string[] };
  body: string;
} {
  if (!content.startsWith("---\n")) return { fm: {}, body: content };
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) return { fm: {}, body: content };
  const rawFm = content.slice(4, end);
  const body = content.slice(end + 5);
  const fm: Record<string, unknown> = {};
  for (const line of rawFm.split("\n")) {
    const [k, ...rest] = line.split(":");
    if (rest.length > 0) fm[k.trim()] = rest.join(":").trim();
  }
  // parse tools list
  const toolsMatch = rawFm.match(/tools:\s*\n((?:\s+-\s+\S+\n?)+)/);
  if (toolsMatch) {
    fm["tools"] = toolsMatch[1]
      .split("\n")
      .map((l) => l.trim().replace(/^-\s+/, ""))
      .filter(Boolean);
  }
  return {
    fm: {
      name: typeof fm["name"] === "string" ? fm["name"] : undefined,
      description: typeof fm["description"] === "string" ? fm["description"] : undefined,
      model: typeof fm["model"] === "string" ? fm["model"] : undefined,
      tools: Array.isArray(fm["tools"]) ? (fm["tools"] as string[]) : undefined,
    },
    body,
  };
}

function buildAgentContent(
  name: string,
  description: string,
  model: string,
  tools: string[],
  body: string,
): string {
  const toolLines = tools.map((t) => `  - ${t}`).join("\n");
  return `---\nname: ${name}\ndescription: ${description}\nmodel: ${model}\ntools:\n${toolLines}\n---\n\n${body}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgentForm({
  content,
  onChange,
}: {
  content: string;
  onChange: (next: string) => void;
}) {
  const { fm, body } = parseAgentFrontmatter(content);
  const [name, setName] = useState(fm.name ?? "");
  const [description, setDescription] = useState(fm.description ?? "");
  const [model, setModel] = useState(fm.model ?? "claude-sonnet-4-6");
  const [tools, setTools] = useState<string[]>(fm.tools ?? ["Read", "Bash"]);
  const [prompt, setPrompt] = useState(body);

  useEffect(() => {
    onChange(buildAgentContent(name, description, model, tools, prompt));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, model, tools, prompt]);

  const toggleTool = (t: string) =>
    setTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Nombre</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            placeholder="mi-agente"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Modelo</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          >
            {AGENT_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Descripción</label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          placeholder="Descripción breve del agente"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Herramientas</label>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABLE_TOOLS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTool(t)}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                tools.includes(t)
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-zinc-800 text-zinc-500 border border-zinc-700 hover:border-zinc-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">System prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-y"
          placeholder="Instrucciones del agente..."
        />
      </div>
    </div>
  );
}

function Editor({
  detail,
  onSave,
  onBack,
  isSingleton,
}: {
  detail: HarnessComponentDetail;
  onSave: (content: string) => Promise<void>;
  onBack: () => void;
  isSingleton?: boolean;
}) {
  const [content, setContent] = useState(detail.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const dirty = content !== detail.content;

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (dirty && !confirm("Hay cambios sin guardar. ¿Salir igualmente?")) return;
    onBack();
  };

  const isAgent = detail.component_type === "agent";
  const isMarkdown = detail.component_type !== "script";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {!isSingleton && (
            <button
              onClick={handleBack}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
            >
              ← Volver
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isMarkdown && !isAgent && (
            <button
              onClick={() => setShowPreview((p) => !p)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {showPreview ? "Editar" : "Preview"}
            </button>
          )}
          <button
            onClick={() => setContent(detail.content)}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Descartar
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-xs rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-zinc-200">{detail.name}</span>
        <span className="text-xs text-zinc-600">
          {detail.component_type} · modificado {fmtDate(detail.modified_at)}
        </span>
        {dirty && <span className="text-xs text-amber-400">sin guardar</span>}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {isAgent ? (
        <AgentForm content={content} onChange={setContent} />
      ) : showPreview ? (
        <div className="min-h-[400px] rounded-md border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-300 font-mono whitespace-pre-wrap overflow-auto">
          {content || <span className="text-zinc-600">Sin contenido</span>}
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={24}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-y"
          placeholder={PLACEHOLDERS[detail.component_type] ?? ""}
        />
      )}
    </div>
  );
}

function NewComponentDialog({
  componentType,
  onClose,
  onCreate,
}: {
  componentType: HarnessComponentType;
  onClose: () => void;
  onCreate: (name: string, content: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"paste" | "generate">("paste");
  const [name, setName] = useState("");
  const [content, setContent] = useState(PLACEHOLDERS[componentType] ?? "");
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canGenerate = GENERATE_TYPES.includes(componentType);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const { content: generated } = await api.harness.generate(componentType, description);
      setContent(generated);
      setMode("paste");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error generando contenido");
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError("El nombre no puede estar vacío"); return; }
    if (!content.trim()) { setError("El contenido no puede estar vacío"); return; }
    setSaving(true);
    setError(null);
    try {
      await onCreate(name.trim(), content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando componente");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-6 shadow-xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-mono font-semibold text-zinc-200">Nuevo {componentType}</h2>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>

        {canGenerate && (
          <div className="flex gap-2">
            <button
              onClick={() => setMode("paste")}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                mode === "paste"
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Pegar texto
            </button>
            <button
              onClick={() => setMode("generate")}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                mode === "generate"
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Generar con IA
            </button>
          </div>
        )}

        {mode === "generate" ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Describe qué quieres generar</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-none"
                placeholder={`Ej: Un agente que revisa migraciones de base de datos y detecta columnas NOT NULL sin default en tablas grandes`}
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !description.trim()}
              className="px-4 py-2 text-xs rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? "Generando…" : "Generar"}
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Nombre</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                placeholder="nombre-del-componente"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Contenido</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-y"
                placeholder={PLACEHOLDERS[componentType] ?? ""}
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !name.trim()}
                className="px-3 py-1.5 text-xs rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "Creando…" : "Crear"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentList({
  items,
  componentType,
  onSelect,
  onDelete,
  onNew,
  isSingleton,
}: {
  items: HarnessComponentSummary[];
  componentType: HarnessComponentType;
  onSelect: (name: string) => void;
  onDelete: (name: string) => void;
  onNew: () => void;
  isSingleton: boolean;
}) {
  return (
    <div className="space-y-2">
      {!isSingleton && (
        <div className="flex justify-end">
          <button
            onClick={onNew}
            className="px-3 py-1.5 text-xs rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
          >
            + Nuevo
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-center py-12 text-zinc-600 text-sm">
          No hay {componentType === "claude_md" ? "archivo CLAUDE.md" : `${componentType}s`} todavía.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60">
          {items.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between py-3 group"
            >
              <button
                onClick={() => onSelect(item.name)}
                className="flex-1 text-left min-w-0"
              >
                <span className="text-sm font-mono text-zinc-200 group-hover:text-amber-300 transition-colors">
                  {item.name}
                </span>
                {item.description && (
                  <span className="ml-2 text-xs text-zinc-500">{item.description}</span>
                )}
                <div className="text-xs text-zinc-700 mt-0.5">{fmtDate(item.modified_at)}</div>
              </button>
              {!isSingleton && (
                <button
                  onClick={() => onDelete(item.name)}
                  className="opacity-0 group-hover:opacity-100 ml-3 text-xs text-zinc-600 hover:text-red-400 transition-all"
                >
                  Eliminar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function HarnessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeType = (searchParams.get("type") ?? "claude_md") as HarnessComponentType;
  const selectedName = searchParams.get("name");

  const [data, setData] = useState<HarnessListResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detail, setDetail] = useState<HarnessComponentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const prevName = useRef<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    api.harness
      .list()
      .then(setData)
      .catch(() => setLoadError("No se puede conectar con el harness. ¿Está el backend arriba?"));
  }, []);

  useEffect(() => { load(); }, [load]);

  // For singleton tabs (claude_md), skip the list and go straight to the editor
  useEffect(() => {
    const info = TYPES.find((t) => t.key === activeType);
    if (info?.singleton && !selectedName) {
      router.replace(`/harness?type=${activeType}&name=CLAUDE.md`);
    }
  }, [activeType, selectedName, router]);

  useEffect(() => {
    if (!selectedName) { setDetail(null); return; }
    if (selectedName === prevName.current) return;
    prevName.current = selectedName;
    setLoadingDetail(true);
    api.harness
      .get(activeType, selectedName)
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoadingDetail(false));
  }, [activeType, selectedName]);

  const setTab = (type: HarnessComponentType) => {
    router.push(`/harness?type=${type}`);
  };

  const selectItem = (name: string) => {
    router.push(`/harness?type=${activeType}&name=${encodeURIComponent(name)}`);
  };

  const goBack = () => {
    prevName.current = null;
    router.push(`/harness?type=${activeType}`);
  };

  const handleSave = async (content: string) => {
    if (!selectedName) return;
    const updated = await api.harness.update(activeType, selectedName, content);
    setDetail(updated);
    load();
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`¿Eliminar "${name}"? Esta acción no se puede deshacer.`)) return;
    await api.harness.delete(activeType, name);
    load();
    if (selectedName === name) goBack();
  };

  const handleCreate = async (name: string, content: string) => {
    await api.harness.create(activeType, name, content);
    setShowNew(false);
    load();
    selectItem(name);
  };

  const typeInfo = TYPES.find((t) => t.key === activeType)!;
  const items: HarnessComponentSummary[] = data?.[activeType] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight">Harness</h1>
        <p className="text-xs text-zinc-600 mt-0.5">Componentes del entorno Claude Code en ~/.claude</p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs font-mono text-red-400">
          {loadError}
        </div>
      )}

      {/* Type tabs */}
      <div className="flex items-center gap-0.5 border-b border-zinc-800">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs font-mono transition-colors border-b-2 -mb-px ${
              activeType === t.key
                ? "border-amber-400 text-amber-300"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
            {data && (
              <span className="ml-1.5 text-zinc-700">
                {data[t.key].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content area */}
      {!data && !loadError ? (
        <div className="text-xs text-zinc-600 py-8 text-center">Cargando…</div>
      ) : selectedName && loadingDetail ? (
        <div className="text-xs text-zinc-600 py-8 text-center">Cargando componente…</div>
      ) : selectedName && detail ? (
        <Editor
          key={`${activeType}/${selectedName}`}
          detail={detail}
          onSave={handleSave}
          onBack={goBack}
          isSingleton={typeInfo.singleton}
        />
      ) : (
        <ComponentList
          items={items}
          componentType={activeType}
          onSelect={selectItem}
          onDelete={handleDelete}
          onNew={() => setShowNew(true)}
          isSingleton={typeInfo.singleton ?? false}
        />
      )}

      {showNew && (
        <NewComponentDialog
          componentType={activeType}
          onClose={() => setShowNew(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

export default function HarnessPage() {
  return (
    <Suspense fallback={null}>
      <HarnessInner />
    </Suspense>
  );
}
