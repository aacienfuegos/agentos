"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, X } from "lucide-react";
import { api } from "@/lib/api";
import { useActiveRuns } from "@/lib/useActiveRuns";
import { runDisplayName } from "@/lib/runDisplay";

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

function fmtElapsed(startedAt: string | null, now: Date): string {
  if (!startedAt) return "pendiente";
  const secs = Math.max(0, Math.round((now.getTime() - asUTC(startedAt).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function ActiveRunsPanel() {
  const { activeRuns, agentNames, kbNames } = useActiveRuns();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleCancel = async (id: string) => {
    setCancellingIds((prev) => new Set(prev).add(id));
    try {
      await api.runs.cancel(id);
    } catch {
      // poll will resync state regardless
    } finally {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1.5 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <Activity className="w-4 h-4" />
        {activeRuns.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-black">
            {activeRuns.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-lg border border-white/[0.06] bg-zinc-900 shadow-xl z-50">
          {activeRuns.length === 0 ? (
            <p className="px-3 py-4 text-xs text-zinc-500 text-center">Sin runs activos</p>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {activeRuns.map((run) => {
                const name = runDisplayName(run, agentNames, kbNames);
                const cancelling = cancellingIds.has(run.id);
                return (
                  <li key={run.id} className="px-3 py-2.5 flex items-start justify-between gap-2">
                    <Link href={`/runs/${run.id}`} className="min-w-0 flex-1" onClick={() => setOpen(false)}>
                      <p className="text-xs font-mono text-zinc-200 truncate">{name}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {run.status === "pending" ? "pendiente" : fmtElapsed(run.started_at, now)}
                      </p>
                    </Link>
                    <button
                      onClick={() => handleCancel(run.id)}
                      disabled={cancelling}
                      className="shrink-0 text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40"
                      title="Cancelar run"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
