import { useState, useEffect, useCallback } from 'react';

/** Base light/dark mode */
export type ThemeMode = 'light' | 'dark';

/** Color scheme names */
export type ColorScheme = 'default' | 'sepia' | 'nord' | 'rosepine';

export interface ThemeConfig {
  mode: ThemeMode;
  colorScheme: ColorScheme;
}

const MODE_KEY = 'pennivo-theme';
const SCHEME_KEY = 'pennivo-color-scheme';

/** All available color schemes with display labels */
export const COLOR_SCHEMES: { id: ColorScheme; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'nord', label: 'Nord' },
  { id: 'rosepine', label: 'Rose Pine' },
];

function getInitialMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage unavailable
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialScheme(): ColorScheme {
  try {
    const stored = localStorage.getItem(SCHEME_KEY);
    if (stored && COLOR_SCHEMES.some(s => s.id === stored)) return stored as ColorScheme;
  } catch {
    // localStorage unavailable
  }
  return 'default';
}

function applyTheme(mode: ThemeMode, scheme: ColorScheme) {
  document.documentElement.setAttribute('data-theme', mode);
  document.documentElement.setAttribute('data-color-scheme', scheme);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);
  const [colorScheme, setSchemeState] = useState<ColorScheme>(getInitialScheme);

  useEffect(() => {
    applyTheme(mode, colorScheme);
    try {
      localStorage.setItem(MODE_KEY, mode);
      localStorage.setItem(SCHEME_KEY, colorScheme);
    } catch {
      // ignore
    }
  }, [mode, colorScheme]);

  const setMode = useCallback((m: ThemeMode) => setModeState(m), []);
  const toggleTheme = useCallback(() => setModeState(m => (m === 'light' ? 'dark' : 'light')), []);
  const setColorScheme = useCallback((s: ColorScheme) => setSchemeState(s), []);

  const cycleColorScheme = useCallback(() => {
    setSchemeState(current => {
      const idx = COLOR_SCHEMES.findIndex(s => s.id === current);
      return COLOR_SCHEMES[(idx + 1) % COLOR_SCHEMES.length].id;
    });
  }, []);

  // Keep backward compatibility: theme = mode for simple checks
  return {
    theme: mode,
    mode,
    colorScheme,
    setTheme: setMode,
    setMode,
    toggleTheme,
    setColorScheme,
    cycleColorScheme,
  };
}

// Re-export for backward compatibility
export type Theme = ThemeMode;
