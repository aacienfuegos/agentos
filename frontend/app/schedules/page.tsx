"use client";

import { useEffect, useState } from "react";
import { api, Schedule, Agent, Run } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const CRON_PRESETS = [
  { label: "Cada hora", value: "0 * * * *" },
  { label: "Cada día a las 2:00", value: "0 2 * * *" },
  { label: "Cada día a las 9:00", value: "0 9 * * *" },
  { label: "Cada lunes a las 8:00", value: "0 8 * * 1" },
  { label: "Cada domingo a las 23:00", value: "0 23 * * 0" },
  { label: "Cada 6 horas", value: "0 */6 * * *" },
  { label: "Personalizado…", value: "custom" },
];

function cronHuman(expr: string): string {
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  return preset ? preset.label : expr;
}

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

function fmtDate(dt: string | null): string {
  if (!dt) return "—";
  return asUTC(dt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ agentId: "", name: "", cron: "", customCron: "", params: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [s, a] = await Promise.all([api.schedules.list(), api.agents.list()]);
    setSchedules(s);
    setAgents(a);
  };

  useEffect(() => { load(); }, []);

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const handleToggle = async (id: string) => {
    await api.schedules.toggle(id);
    load();
  };

  const handleRunNow = async (id: string) => {
    const run = await api.schedules.runNow(id);
    window.location.href = `/runs/${run.id}`;
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar esta automatización?")) return;
    await api.schedules.delete(id);
    load();
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const cron = form.cron === "custom" ? form.customCron : form.cron;
      let params: Record<string, unknown> = {};
      if (form.params.trim()) params = JSON.parse(form.params);
      await api.schedules.create({
        agent_id: form.agentId,
        name: form.name,
        cron_expression: cron,
        input_params: params,
      });
      setShowNew(false);
      setForm({ agentId: "", name: "", cron: "", customCron: "", params: "" });
      load();
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Automatizaciones</h1>
        <Button
          className="bg-violet-600 hover:bg-violet-700"
          size="sm"
          onClick={() => setShowNew(true)}
        >
          + Nueva automatización
        </Button>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Nombre</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Agente</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Frecuencia</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Próxima ejecución</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Estado</th>
              <th className="text-left px-4 py-3 text-xs text-zinc-500 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3 text-zinc-200">{s.name}</td>
                <td className="px-4 py-3 text-zinc-400">{agentMap[s.agent_id]?.name ?? s.agent_id}</td>
                <td className="px-4 py-3 text-zinc-400 font-mono text-xs">{cronHuman(s.cron_expression)}</td>
                <td className="px-4 py-3 text-zinc-500 text-xs">{fmtDate(s.next_run_at)}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.enabled ? "bg-green-900 text-green-300" : "bg-zinc-800 text-zinc-500"}`}>
                    {s.enabled ? "activo" : "inactivo"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => handleToggle(s.id)}
                      className="text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
                      {s.enabled ? "Pausar" : "Activar"}
                    </button>
                    <button onClick={() => handleRunNow(s.id)}
                      className="text-xs px-2 py-1 rounded bg-violet-900 hover:bg-violet-800 text-violet-300">
                      Ahora
                    </button>
                    <button onClick={() => handleDelete(s.id)}
                      className="text-xs px-2 py-1 rounded bg-red-950 hover:bg-red-900 text-red-400">
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {schedules.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">Sin automatizaciones configuradas</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Nueva automatización</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Nombre</Label>
              <input
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="ej: Code review nocturno"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Agente</Label>
              <Select value={form.agentId} onValueChange={(v) => setForm((f) => ({ ...f, agentId: v ?? "" }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                  <SelectValue placeholder="Seleccionar agente…" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id} className="text-zinc-100">{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Frecuencia</Label>
              <Select value={form.cron} onValueChange={(v) => setForm((f) => ({ ...f, cron: v ?? "" }))}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100">
                  <SelectValue placeholder="Seleccionar frecuencia…" />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-zinc-100">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.cron === "custom" && (
                <input
                  className="w-full mt-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="0 2 * * * (cron expression)"
                  value={form.customCron}
                  onChange={(e) => setForm((f) => ({ ...f, customCron: e.target.value }))}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-zinc-300 text-sm">Parámetros (JSON, opcional)</Label>
              <Textarea
                className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder-zinc-600 font-mono text-xs resize-none"
                placeholder='{"repo": "usuario/repo", "focus": "security"}'
                rows={3}
                value={form.params}
                onChange={(e) => setForm((f) => ({ ...f, params: e.target.value }))}
              />
            </div>
            <Button
              className="w-full bg-violet-600 hover:bg-violet-700"
              onClick={handleCreate}
              disabled={saving || !form.agentId || !form.name || (!form.cron || (form.cron === "custom" && !form.customCron))}
            >
              {saving ? "Guardando…" : "Crear automatización"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
