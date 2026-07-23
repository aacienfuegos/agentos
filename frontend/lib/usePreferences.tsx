"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type SyntaxTheme = "atom-one-dark" | "github-dark" | "tokyo-night";
export type TextSize = "compact" | "normal";

export interface Preferences {
  readonly syntaxTheme: SyntaxTheme;
  readonly textSize: TextSize;
  readonly markdownRawDefault: boolean;
  readonly autoScroll: boolean;
}

const STORAGE_KEY = "agentos:preferences";

const DEFAULT_PREFERENCES: Preferences = {
  syntaxTheme: "atom-one-dark",
  textSize: "normal",
  markdownRawDefault: false,
  autoScroll: true,
};

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

interface PreferencesContextValue {
  readonly preferences: Preferences;
  readonly setPreferences: (update: Partial<Preferences>) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferencesState] = useState<Preferences>(DEFAULT_PREFERENCES);

  // Defaults on the server/first client render keep SSR and hydration in sync;
  // the real localStorage value is applied right after mount.
  useEffect(() => {
    setPreferencesState(loadPreferences());
  }, []);

  const setPreferences = (update: Partial<Preferences>) => {
    setPreferencesState((prev) => {
      const next = { ...prev, ...update };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return (
    <PreferencesContext.Provider value={{ preferences, setPreferences }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used within PreferencesProvider");
  return ctx;
}
