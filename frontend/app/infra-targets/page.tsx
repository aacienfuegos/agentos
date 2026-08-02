"use client";

import { useEffect, useState } from "react";
import { api, InfraTarget, Agent } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_SUDO_COMMANDS = [
  "/usr/bin/docker ps",
  "/usr/bin/docker ps -a",
  "/usr/bin/journalctl --no-pager -n 100",
];

const emptyForm = {
  id: "",
  name: "",
  host: "",
  ssh_user: "agentos",
  ssh_port: "22",
  notes: "",
  sudo_commands: DEFAULT_SUDO_COMMANDS.join("\n"),
};

export default function InfraTargetsPage() {
  const [targets, setTargets] = useState<InfraTarget[]>([]);
  const [hasInfraArchitect, setHasInfraArchitect] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<InfraTarget | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [setupCommands, setSetupCommands] = useState<{ id: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

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
      sudo_commands: target.sudo_commands.join("\n"),
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
        sudo_commands: form.sudo_commands
          .split("\n")
          .map((c) => c.trim())
          .filter(Boolean),
      };
      if (editing) {
        await api.infraTargets.update(editing.id, payload);
        closeDialog();
        load();
      } else {
        const created = await api.infraTargets.create({ id: form.id, ...payload });
        closeDialog();
        load();
        const { commands } = await api.infraTargets.setupCommands(created.id);
        setSetupCommands({ id: created.id, text: commands });
      }
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleShowCommands = async (id: string) => {
    try {
      const { commands } = await api.infraTargets.setupCommands(id);
      setSetupCommands({ id, text: commands });
    } catch (e) {
      alert(`Error: ${e}`);
    }
  };

  const handleRegenerateKey = async (id: string) => {
    if (!confirm("La clave anterior dejará de funcionar en el host hasta que vuelvas a instalar la nueva. ¿Regenerar?")) return;
    setRegenerating(true);
    try {
      const updated = await api.infraTargets.regenerateKey(id);
      setEditing(updated);
      await load();
      const { commands } = await api.infraTargets.setupCommands(id);
      setSetupCommands({ id, text: commands });
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setRegenerating(false);
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

  const handleVerifyHost = async (id: string) => {
    setVerifying(id);
    try {
      await api.infraTargets.verifyHost(id);
      await load();
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setVerifying(null);
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
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Host key</th>
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
                <td className="px-4 py-3 text-xs">
                  {t.host_key_fingerprint ? (
                    <span className="text-emerald-400 font-mono" title={t.host_key_fingerprint}>
                      ✓ verificada
                    </span>
                  ) : (
                    <span className="text-amber-400">sin verificar</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs max-w-xs truncate">{t.notes || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleShowCommands(t.id)}
                      disabled={!t.ssh_public_key}
                      title={!t.ssh_public_key ? "Sin clave SSH generada" : undefined}
                      className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Comandos
                    </button>
                    <button
                      onClick={() => handleVerifyHost(t.id)}
                      disabled={verifying === t.id}
                      className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {verifying === t.id ? "Verificando…" : t.host_key_fingerprint ? "Re-verificar" : "Verificar host"}
                    </button>
                    <button
                      onClick={() => handleRunDiagnostic(t.id)}
                      disabled={!hasInfraArchitect || !t.host_key_fingerprint || running === t.id}
                      title={!t.host_key_fingerprint ? "Verifica la host key antes de lanzar el diagnóstico" : undefined}
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
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">Sin targets de infraestructura configurados</td>
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
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Comandos que requieren sudo (uno por línea)</Label>
              <p className="text-xs text-zinc-600">
                El agente ya puede ejecutar cualquier comando de solo lectura en su scope normal de
                usuario sin privilegios (uptime, df -h, ip a…). Lista aquí solo lo que de verdad
                necesita privilegio (ej. docker ps) — se autoriza vía sudoers, nada más.
              </p>
              <Textarea
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600 font-mono text-xs resize-none"
                placeholder="/usr/bin/docker ps"
                rows={4}
                value={form.sudo_commands}
                onChange={(e) => setForm((f) => ({ ...f, sudo_commands: e.target.value }))}
              />
            </div>
            {editing?.ssh_public_key && (
              <div className="space-y-1.5 border-t border-zinc-800 pt-4">
                <Label className="text-zinc-300 text-sm">Clave pública SSH (generada automáticamente)</Label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-mono text-zinc-400"
                    value={editing.ssh_public_key}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(editing.ssh_public_key ?? "")}
                    className="shrink-0 text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    Copiar
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-600">
                    No es secreta — puedes pegarla en cualquier host adicional sin recrear este target.
                  </p>
                  <button
                    onClick={() => handleRegenerateKey(editing.id)}
                    disabled={regenerating}
                    className="shrink-0 text-xs px-2 py-1 rounded bg-red-950 hover:bg-red-900 text-red-400 disabled:opacity-40"
                  >
                    {regenerating ? "Regenerando…" : "Regenerar clave"}
                  </button>
                </div>
              </div>
            )}
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

      <Dialog
        open={setupCommands !== null}
        onOpenChange={(open) => { if (!open) { setSetupCommands(null); setCopied(false); } }}
      >
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-[calc(100%-2rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Comandos de instalación — {setupCommands?.id}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-zinc-500">
            Ejecuta esto en el host de destino (no en AgentOS) para dar acceso al agente.
          </p>
          <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-sm text-zinc-300 overflow-x-auto whitespace-pre-wrap max-h-[70vh]">
            {setupCommands?.text}
          </pre>
          <Button
            className="w-full bg-violet-600 hover:bg-violet-700"
            onClick={() => {
              navigator.clipboard.writeText(setupCommands?.text ?? "");
              setCopied(true);
            }}
          >
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
