import { useState, useEffect, useCallback } from "react";

/**
 * Theme mode.
 * - "light" / "dark": explicit user choice, locked.
 * - "system": follow OS preference dynamically (reacts at runtime).
 */
export type ThemeMode = "light" | "dark" | "system";

/** The resolved mode actually applied to the DOM. Always "light" or "dark". */
export type ResolvedThemeMode = "light" | "dark";

/** Color scheme names */
export type ColorScheme = "default" | "sepia" | "nord" | "rosepine";

export interface ThemeConfig {
  mode: ThemeMode;
  colorScheme: ColorScheme;
}

const MODE_KEY = "pennivo-theme";
const SCHEME_KEY = "pennivo-color-scheme";

/** All available color schemes with display labels */
export const COLOR_SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "sepia", label: "Sepia" },
  { id: "nord", label: "Nord" },
  { id: "rosepine", label: "Rose Pine" },
];

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function getInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  // No stored preference — follow the OS.
  return "system";
}

function getInitialScheme(): ColorScheme {
  try {
    const stored = localStorage.getItem(SCHEME_KEY);
    if (stored && COLOR_SCHEMES.some((s) => s.id === stored))
      return stored as ColorScheme;
  } catch {
    // localStorage unavailable
  }
  return "default";
}

function resolveMode(mode: ThemeMode): ResolvedThemeMode {
  if (mode === "light" || mode === "dark") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

function applyTheme(resolved: ResolvedThemeMode, scheme: ColorScheme) {
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-color-scheme", scheme);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [colorScheme, setSchemeState] = useState<ColorScheme>(getInitialScheme);
  const [resolvedMode, setResolvedMode] = useState<ResolvedThemeMode>(() =>
    resolveMode(getInitialMode()),
  );

  // Whenever the user's preference changes, recompute the resolved mode.
  useEffect(() => {
    setResolvedMode(resolveMode(mode));
  }, [mode]);

  // Subscribe to OS theme changes — only takes effect when mode is "system".
  useEffect(() => {
    if (mode !== "system") return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const handler = (e: MediaQueryListEvent) => {
      setResolvedMode(e.matches ? "dark" : "light");
    };
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    // Legacy Safari fallback
    const legacy = mq as unknown as {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    if (typeof legacy.addListener === "function") {
      legacy.addListener(handler);
      return () => legacy.removeListener?.(handler);
    }
  }, [mode]);

  // Apply resolved theme + color scheme to the DOM, persist the user's choice.
  useEffect(() => {
    applyTheme(resolvedMode, colorScheme);
    try {
      localStorage.setItem(MODE_KEY, mode);
      localStorage.setItem(SCHEME_KEY, colorScheme);
    } catch {
      // ignore
    }
  }, [mode, resolvedMode, colorScheme]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);

  // toggleTheme flips based on what's currently showing, and locks to that
  // explicit choice (so it escapes "system" mode, as users expect).
  const toggleTheme = useCallback(() => {
    setModeState((current) => {
      const shownDark =
        current === "dark" || (current === "system" && systemPrefersDark());
      return shownDark ? "light" : "dark";
    });
  }, []);

  const setColorScheme = useCallback((s: ColorScheme) => setSchemeState(s), []);

  const cycleColorScheme = useCallback(() => {
    setSchemeState((current) => {
      const idx = COLOR_SCHEMES.findIndex((s) => s.id === current);
      return COLOR_SCHEMES[(idx + 1) % COLOR_SCHEMES.length].id;
    });
  }, []);

  // Backward compatibility: `theme` used to be the applied light/dark mode.
  // Keep that behavior so existing consumers that branch on light vs dark
  // (e.g. icon choice) continue to work.
  return {
    theme: resolvedMode,
    mode,
    resolvedMode,
    colorScheme,
    setTheme: setMode,
    setMode,
    toggleTheme,
    setColorScheme,
    cycleColorScheme,
  };
}

// Re-export for backward compatibility
export type Theme = ResolvedThemeMode;
