"use client";

import { useEffect, useState } from "react";
import { api, ApiKey, ApiKeyCreated } from "@/lib/api";

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

function fmt(dt: string | null): string {
  if (!dt) return "—";
  return asUTC(dt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function SettingsPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    api.apiKeys.list().then(setKeys).catch(() => setError("Error cargando API keys")).finally(() => setLoading(false));

  useEffect(() => { refresh(); }, []);

  async function handleCreate(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await api.apiKeys.create(newName.trim());
      setCreatedKey(created);
      setNewName("");
      refresh();
    } catch {
      setError("Error creando API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`¿Revocar la key "${name}"? Esta acción no se puede deshacer.`)) return;
    setRevoking(id);
    setError(null);
    try {
      await api.apiKeys.delete(id);
      refresh();
    } catch {
      setError("Error revocando API key");
    } finally {
      setRevoking(null);
    }
  }

  async function handleCopy(raw: string) {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-base font-mono font-semibold text-zinc-200 tracking-tight">Configuración</h1>
        <p className="text-xs text-zinc-600 mt-1">Gestión de API keys para acceso server-to-server.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs font-mono text-red-400">
          {error}
        </div>
      )}

      {/* Modal: nueva key creada */}
      {createdKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-white/[0.08] rounded-xl p-6 max-w-lg w-full mx-4 space-y-4">
            <h2 className="font-mono font-semibold text-zinc-100">API key creada</h2>
            <p className="text-xs text-amber-400/80">
              Copia esta key ahora. No se volverá a mostrar.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-zinc-950 border border-white/[0.06] rounded-md px-3 py-2 text-xs font-mono text-emerald-400 break-all">
                {createdKey.raw_key}
              </code>
              <button
                onClick={() => handleCopy(createdKey.raw_key)}
                className="shrink-0 px-3 py-2 rounded-md text-xs font-mono border border-white/[0.06] hover:bg-white/[0.05] text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {copied ? "✓" : "Copiar"}
              </button>
            </div>
            <button
              onClick={() => { setCreatedKey(null); setCopied(false); }}
              className="w-full py-2 rounded-md text-xs font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
            >
              He copiado la key — cerrar
            </button>
          </div>
        </div>
      )}

      {/* Formulario de creación */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono uppercase tracking-widest text-zinc-600">Nueva API key</h2>
        <form onSubmit={handleCreate} className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre (ej: tripplanner-prod)"
            className="flex-1 bg-zinc-900 border border-white/[0.06] rounded-md px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-amber-400/30 transition-colors"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="px-4 py-2 rounded-md text-xs font-mono bg-amber-400 hover:bg-amber-300 text-zinc-950 font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {creating ? "Creando…" : "Crear"}
          </button>
        </form>
        <p className="text-[11px] text-zinc-700 font-mono">
          Formato: <span className="text-zinc-500">sk-agentos-…</span>
          {"  ·  "}
          Header: <span className="text-zinc-500">Authorization: Bearer &lt;key&gt;</span>
          {"  ·  "}
          Acceso: <span className="text-zinc-500">/api/execute, /api/runs</span>
        </p>
      </section>

      {/* Listado de keys */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono uppercase tracking-widest text-zinc-600">Keys activas</h2>
        {loading ? (
          <p className="text-xs font-mono text-zinc-700">cargando…</p>
        ) : keys.length === 0 ? (
          <p className="text-xs font-mono text-zinc-700">— sin API keys —</p>
        ) : (
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600">Nombre</th>
                  <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600">Creada</th>
                  <th className="text-left px-4 py-3 text-[11px] font-mono uppercase tracking-widest text-zinc-600">Último uso</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {keys.map((key, i) => (
                  <tr
                    key={key.id}
                    className={`border-b border-white/[0.03] ${i === keys.length - 1 ? "border-b-0" : ""}`}
                  >
                    <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{key.name}</td>
                    <td className="px-4 py-3 text-zinc-600 font-mono text-xs">{fmt(key.created_at)}</td>
                    <td className="px-4 py-3 text-zinc-600 font-mono text-xs">{fmt(key.last_used_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRevoke(key.id, key.name)}
                        disabled={revoking === key.id}
                        className="text-xs font-mono text-red-500/60 hover:text-red-400 transition-colors disabled:opacity-40"
                      >
                        {revoking === key.id ? "revocando…" : "revocar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
