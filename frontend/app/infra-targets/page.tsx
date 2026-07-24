"use client";

import { useEffect, useState } from "react";
import { api, InfraTarget, Agent } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const emptyForm = { id: "", name: "", host: "", ssh_user: "agentos", ssh_port: "22", notes: "" };

export default function InfraTargetsPage() {
  const [targets, setTargets] = useState<InfraTarget[]>([]);
  const [hasInfraArchitect, setHasInfraArchitect] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<InfraTarget | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);

  const load = async () => {
    const [t, agents] = await Promise.all([api.infraTargets.list(), api.agents.list()]);
    setTargets(t);
    setHasInfraArchitect(agents.some((a: Agent) => a.id === "infra-architect"));
  };

  useEffect(() => { load(); }, []);

  const openEdit = (target: InfraTarget) => {
    setEditing(target);
    setForm({
      id: target.id,
      name: target.name,
      host: target.host,
      ssh_user: target.ssh_user,
      ssh_port: String(target.ssh_port),
      notes: target.notes,
    });
  };

  const closeDialog = () => {
    setShowNew(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        host: form.host,
        ssh_user: form.ssh_user,
        ssh_port: Number(form.ssh_port) || 22,
        notes: form.notes,
      };
      if (editing) {
        await api.infraTargets.update(editing.id, payload);
      } else {
        await api.infraTargets.create({ id: form.id, ...payload });
      }
      closeDialog();
      load();
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este target de infraestructura?")) return;
    await api.infraTargets.delete(id);
    load();
  };

  const handleRunDiagnostic = async (id: string) => {
    setRunning(id);
    try {
      const run = await api.runs.create("infra-architect", { target_id: id });
      window.location.href = `/runs/${run.id}`;
    } catch (e) {
      alert(`Error: ${e}`);
      setRunning(null);
    }
  };

  const dialogOpen = showNew || editing !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Infraestructura</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Hosts gestionables por SSH para diagnóstico con <code className="text-zinc-400">infra-architect</code>.
          </p>
        </div>
        <Button className="bg-violet-600 hover:bg-violet-700" size="sm" onClick={() => setShowNew(true)}>
          + Nuevo target
        </Button>
      </div>

      {!hasInfraArchitect && (
        <div className="bg-amber-950/40 border border-amber-900/60 text-amber-300 text-xs rounded-lg px-4 py-3">
          El agente <code>infra-architect</code> no está registrado (requiere <code>INFRA_AGENTS_ENABLED=true</code>).
          Puedes seguir definiendo targets, pero el botón &ldquo;Diagnóstico&rdquo; no funcionará hasta activarlo.
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Nombre</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Conexión SSH</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Notas</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3 text-zinc-200">
                  {t.name}
                  <div className="text-xs text-zinc-600 font-mono">{t.id}</div>
                </td>
                <td className="px-4 py-3 text-zinc-400 font-mono text-xs">
                  ssh -p {t.ssh_port} {t.ssh_user}@{t.host}
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs max-w-xs truncate">{t.notes || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRunDiagnostic(t.id)}
                      disabled={!hasInfraArchitect || running === t.id}
                      className="text-xs px-2 py-1 rounded bg-violet-900 hover:bg-violet-800 text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {running === t.id ? "Lanzando…" : "Diagnóstico"}
                    </button>
                    <button onClick={() => openEdit(t)}
                      className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
                      Editar
                    </button>
                    <button onClick={() => handleDelete(t.id)}
                      className="text-xs px-2 py-1 rounded bg-red-950 hover:bg-red-900 text-red-400">
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {targets.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-zinc-600">Sin targets de infraestructura configurados</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar target" : "Nuevo target de infraestructura"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {!editing && (
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Id (slug)</Label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="ej: homelab-dev"
                  value={form.id}
                  onChange={(e) => setForm((f) => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Nombre</Label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="ej: Homelab Dev"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-zinc-300 text-sm">Host</Label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="ej: infra-dev-target"
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-300 text-sm">Puerto</Label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  value={form.ssh_port}
                  onChange={(e) => setForm((f) => ({ ...f, ssh_port: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Usuario SSH</Label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                value={form.ssh_user}
                onChange={(e) => setForm((f) => ({ ...f, ssh_user: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Notas</Label>
              <Textarea
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600 text-xs resize-none"
                placeholder="Contexto para el agente: qué corre en este host, qué comprobar…"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <Button
              className="w-full bg-violet-600 hover:bg-violet-700"
              onClick={handleSave}
              disabled={saving || !form.name || !form.host || !form.ssh_user || (!editing && !form.id)}
            >
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear target"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
