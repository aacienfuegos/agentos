"use client";

import { useEffect } from "react";
import { usePreferences } from "@/lib/usePreferences";

const LINK_ID = "hljs-theme-link";

// highlight.js themes are copied into public/hljs/ (see frontend/public/hljs/)
// so the active one can be swapped at runtime by changing a <link> href,
// instead of relying on webpack CSS chunk imports which can't be unloaded.
export function SyntaxThemeLoader() {
  const { preferences } = usePreferences();

  useEffect(() => {
    let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = LINK_ID;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `/hljs/${preferences.syntaxTheme}.css`;
  }, [preferences.syntaxTheme]);

  return null;
}
