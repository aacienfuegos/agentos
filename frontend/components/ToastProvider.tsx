"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: "success" | "error" | "info";
  href?: string;
  autoDismissMs?: number | null;
}

interface Toast extends ToastInput {
  id: string;
}

interface ToastContextValue {
  pushToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const VARIANT_STYLES: Record<NonNullable<ToastInput["variant"]>, string> = {
  success: "border-emerald-500/20 bg-emerald-500/[0.04]",
  error: "border-red-500/20 bg-red-500/[0.04]",
  info: "border-white/[0.06] bg-zinc-900",
};

let idCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback((toast: ToastInput) => {
    const id = `toast-${++idCounter}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    const autoDismissMs = toast.autoDismissMs ?? (toast.variant === "error" ? null : 5000);
    if (autoDismissMs !== null) {
      timers.current.set(id, setTimeout(() => dismiss(id), autoDismissMs));
    }
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
        {toasts.map((t) => {
          const card = (
            <div className={`rounded-lg border px-3 py-2.5 shadow-lg backdrop-blur-sm ${VARIANT_STYLES[t.variant ?? "info"]}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-mono text-zinc-200 truncate">{t.title}</p>
                  {t.description && <p className="text-[11px] text-zinc-500 mt-0.5">{t.description}</p>}
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(t.id); }}
                  className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
          return t.href ? (
            <Link key={t.id} href={t.href} onClick={() => dismiss(t.id)}>{card}</Link>
          ) : (
            <div key={t.id}>{card}</div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
