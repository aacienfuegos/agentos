"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Run } from "./api";
import { useToast } from "@/components/ToastProvider";
import { runDisplayName } from "./runDisplay";

const POLL_MS = 4000;

interface ActiveRunsContextValue {
  activeRuns: Run[];
  agentNames: Record<string, string>;
  kbNames: Record<string, string>;
}

const ActiveRunsContext = createContext<ActiveRunsContextValue>({
  activeRuns: [],
  agentNames: {},
  kbNames: {},
});

export function useActiveRuns(): ActiveRunsContextValue {
  return useContext(ActiveRunsContext);
}

const asUTC = (s: string) => new Date(s.endsWith("Z") ? s : s + "Z");

function fmtDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return "—";
  const end = finishedAt ? asUTC(finishedAt) : new Date();
  const secs = Math.max(0, Math.round((end.getTime() - asUTC(startedAt).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function ActiveRunsProvider({ children }: { children: ReactNode }) {
  const { pushToast } = useToast();
  const [activeRuns, setActiveRuns] = useState<Run[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [kbNames, setKbNames] = useState<Record<string, string>>({});
  const agentNamesRef = useRef<Record<string, string>>({});
  const kbNamesRef = useRef<Record<string, string>>({});
  const prevIdsRef = useRef<Set<string>>(new Set());
  const namesLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadNames = async () => {
      if (namesLoadedRef.current) return;
      try {
        const [agents, kbs] = await Promise.all([api.agents.list(), api.knowledgeBases.list()]);
        if (cancelled) return;
        const am = Object.fromEntries(agents.map((a) => [a.id, a.name]));
        const km = Object.fromEntries(kbs.map((k) => [k.id, k.name]));
        agentNamesRef.current = am;
        kbNamesRef.current = km;
        setAgentNames(am);
        setKbNames(km);
        namesLoadedRef.current = true;
      } catch {
        // not authenticated yet (e.g. /login) or transient network error — retry next poll
      }
    };

    const poll = async () => {
      try {
        await loadNames();
        const runs = await api.runs.list({ statuses: ["pending", "running"] });
        if (cancelled) return;

        const currentIds = new Set(runs.map((r) => r.id));
        const finishedIds = [...prevIdsRef.current].filter((id) => !currentIds.has(id));
        prevIdsRef.current = currentIds;
        setActiveRuns(runs);

        for (const id of finishedIds) {
          const run = await api.runs.get(id);
          if (cancelled) return;
          if (run.status !== "success" && run.status !== "failed") continue;
          const name = runDisplayName(run, agentNamesRef.current, kbNamesRef.current);
          const cost = run.cost_usd ? ` · $${run.cost_usd.toFixed(4)}` : "";
          pushToast({
            title: `${name} — ${run.status === "success" ? "completado" : "error"}`,
            description: `${fmtDuration(run.started_at, run.finished_at)}${cost}`,
            variant: run.status === "success" ? "success" : "error",
            href: `/runs/${run.id}`,
          });
        }
      } catch {
        // transient network/auth error — next poll will retry
      }
    };

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [pushToast]);

  return (
    <ActiveRunsContext.Provider value={{ activeRuns, agentNames, kbNames }}>
      {children}
    </ActiveRunsContext.Provider>
  );
}
