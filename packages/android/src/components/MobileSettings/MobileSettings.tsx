import { useState, useEffect, useCallback } from "react";
import { getPlatform, COLOR_SCHEMES } from "@pennivo/ui";
import type { ColorScheme, ThemeMode } from "@pennivo/ui";
import "./MobileSettings.css";

export interface MobileSettingsProps {
  onBack: () => void;
  themeMode: ThemeMode;
  colorScheme: ColorScheme;
  onModeChange: (mode: ThemeMode) => void;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  onSettingsChange?: (settings: Record<string, unknown>) => void;
}

interface EditorSettings {
  editorFontSize: number;
  editorFontFamily: string;
  editorLineHeight: string;
  showLineNumbers: boolean;
  autoSave: boolean;
  spellcheck: boolean;
  typewriterMode: boolean;
  focusMode: boolean;
}

const DEFAULT_SETTINGS: EditorSettings = {
  editorFontSize: 16,
  editorFontFamily: "serif",
  editorLineHeight: "normal",
  showLineNumbers: false,
  autoSave: true,
  spellcheck: true,
  typewriterMode: false,
  focusMode: false,
};

const FONT_FAMILIES: { value: string; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans-serif", label: "Sans-serif" },
  { value: "monospace", label: "Monospace" },
];

const LINE_HEIGHTS: { value: string; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "normal", label: "Normal" },
  { value: "relaxed", label: "Relaxed" },
];

export function MobileSettings({
  onBack,
  themeMode,
  colorScheme,
  onModeChange,
  onColorSchemeChange,
  onSettingsChange,
}: MobileSettingsProps) {
  const platform = getPlatform();
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [appVersion, setAppVersion] = useState("0.1.0");

  // Load settings on mount
  useEffect(() => {
    let cancelled = false;
    platform.getSettings().then((saved) => {
      if (cancelled) return;
      if (saved && typeof saved === "object") {
        setSettings((prev) => ({ ...prev, ...saved }));
      }
      setLoaded(true);
    });
    platform.getAppInfo().then((info) => {
      if (cancelled) return;
      setAppVersion(info.version);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  // Apply font size to CSS
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.style.setProperty(
      "--text-base",
      `${settings.editorFontSize}px`,
    );
  }, [settings.editorFontSize, loaded]);

  // Apply font family to CSS
  useEffect(() => {
    if (!loaded) return;
    const families: Record<string, string> = {
      serif: '"Georgia", "Times New Roman", serif',
      "sans-serif": '"Segoe UI", system-ui, sans-serif',
      monospace: '"Cascadia Code", "Fira Code", "Consolas", monospace',
    };
    document.documentElement.style.setProperty(
      "--font-editor",
      families[settings.editorFontFamily] || families["serif"],
    );
  }, [settings.editorFontFamily, loaded]);

  // Apply line height to CSS
  useEffect(() => {
    if (!loaded) return;
    const heights: Record<string, string> = {
      compact: "1.4",
      normal: "1.6",
      relaxed: "1.9",
    };
    document.documentElement.style.setProperty(
      "--editor-line-height",
      heights[settings.editorLineHeight] || "1.6",
    );
  }, [settings.editorLineHeight, loaded]);

  const persistSettings = useCallback(
    (updated: EditorSettings) => {
      setSettings(updated);
      platform.setSettings(updated as unknown as Record<string, unknown>);
      onSettingsChange?.(updated as unknown as Record<string, unknown>);
    },
    [platform, onSettingsChange],
  );

  const updateSetting = useCallback(
    <K extends keyof EditorSettings>(key: K, value: EditorSettings[K]) => {
      const updated = { ...settings, [key]: value };
      persistSettings(updated);
    },
    [settings, persistSettings],
  );

  const decreaseFontSize = useCallback(() => {
    if (settings.editorFontSize > 12) {
      updateSetting("editorFontSize", settings.editorFontSize - 1);
    }
  }, [settings.editorFontSize, updateSetting]);

  const increaseFontSize = useCallback(() => {
    if (settings.editorFontSize < 24) {
      updateSetting("editorFontSize", settings.editorFontSize + 1);
    }
  }, [settings.editorFontSize, updateSetting]);

  return (
    <div className="msettings">
      {/* Header */}
      <header className="msettings-header">
        <button
          className="msettings-back-btn"
          onClick={onBack}
          aria-label="Back"
          type="button"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="12,4 6,10 12,16" />
          </svg>
        </button>
        <span className="msettings-title">Settings</span>
        <div className="msettings-header-spacer" />
      </header>

      {/* Body */}
      <div className="msettings-body">
        {/* ─── Editor Section ─── */}
        <section className="msettings-section">
          <h2 className="msettings-section-title">Editor</h2>

          {/* Font Size */}
          <div className="msettings-row">
            <div className="msettings-label">
              Font Size
              <span className="msettings-label-desc">12 - 24px</span>
            </div>
            <div className="msettings-stepper">
              <button
                className="msettings-stepper-btn"
                onClick={decreaseFontSize}
                disabled={settings.editorFontSize <= 12}
                aria-label="Decrease font size"
                type="button"
              >
                -
              </button>
              <span className="msettings-stepper-value">
                {settings.editorFontSize}px
              </span>
              <button
                className="msettings-stepper-btn"
                onClick={increaseFontSize}
                disabled={settings.editorFontSize >= 24}
                aria-label="Increase font size"
                type="button"
              >
                +
              </button>
            </div>
          </div>

          {/* Font Family */}
          <div className="msettings-row">
            <div className="msettings-label">Font Family</div>
            <div className="msettings-chip-group">
              {FONT_FAMILIES.map((f) => (
                <button
                  key={f.value}
                  className={`msettings-chip${settings.editorFontFamily === f.value ? " msettings-chip--active" : ""}`}
                  onClick={() => updateSetting("editorFontFamily", f.value)}
                  type="button"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Line Height */}
          <div className="msettings-row">
            <div className="msettings-label">Line Height</div>
            <div className="msettings-chip-group">
              {LINE_HEIGHTS.map((lh) => (
                <button
                  key={lh.value}
                  className={`msettings-chip${settings.editorLineHeight === lh.value ? " msettings-chip--active" : ""}`}
                  onClick={() => updateSetting("editorLineHeight", lh.value)}
                  type="button"
                >
                  {lh.label}
                </button>
              ))}
            </div>
          </div>

          {/* Show Line Numbers */}
          <div className="msettings-row">
            <div className="msettings-label">
              Line Numbers
              <span className="msettings-label-desc">In source mode</span>
            </div>
            <button
              className={`msettings-toggle${settings.showLineNumbers ? " msettings-toggle--on" : ""}`}
              onClick={() =>
                updateSetting("showLineNumbers", !settings.showLineNumbers)
              }
              role="switch"
              aria-checked={settings.showLineNumbers}
              type="button"
            >
              <span className="msettings-toggle-knob" />
            </button>
          </div>
        </section>

        {/* ─── Theme Section ─── */}
        <section className="msettings-section">
          <h2 className="msettings-section-title">Theme</h2>

          {/* Light / Dark */}
          <div className="msettings-row">
            <div className="msettings-label">Mode</div>
            <div className="msettings-chip-group">
              <button
                className={`msettings-chip${themeMode === "light" ? " msettings-chip--active" : ""}`}
                onClick={() => onModeChange("light")}
                type="button"
              >
                <span className="msettings-swatch msettings-swatch--light" />
                Light
              </button>
              <button
                className={`msettings-chip${themeMode === "dark" ? " msettings-chip--active" : ""}`}
                onClick={() => onModeChange("dark")}
                type="button"
              >
                <span className="msettings-swatch msettings-swatch--dark" />
                Dark
              </button>
            </div>
          </div>

          {/* Color Scheme */}
          <div className="msettings-row msettings-row--stacked">
            <div className="msettings-label">Color Scheme</div>
            <div className="msettings-scheme-grid">
              {COLOR_SCHEMES.map((scheme) => (
                <button
                  key={scheme.id}
                  className={`msettings-scheme-btn${colorScheme === scheme.id ? " msettings-scheme-btn--active" : ""}`}
                  onClick={() => onColorSchemeChange(scheme.id)}
                  type="button"
                >
                  <span
                    className={`msettings-swatch msettings-swatch--${scheme.id}`}
                  />
                  {scheme.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Writing Section ─── */}
        <section className="msettings-section">
          <h2 className="msettings-section-title">Writing</h2>

          <div className="msettings-row">
            <div className="msettings-label">
              Auto-save
              <span className="msettings-label-desc">
                Save files automatically
              </span>
            </div>
            <button
              className={`msettings-toggle${settings.autoSave ? " msettings-toggle--on" : ""}`}
              onClick={() => updateSetting("autoSave", !settings.autoSave)}
              role="switch"
              aria-checked={settings.autoSave}
              type="button"
            >
              <span className="msettings-toggle-knob" />
            </button>
          </div>

          <div className="msettings-row">
            <div className="msettings-label">Spell Check</div>
            <button
              className={`msettings-toggle${settings.spellcheck ? " msettings-toggle--on" : ""}`}
              onClick={() => updateSetting("spellcheck", !settings.spellcheck)}
              role="switch"
              aria-checked={settings.spellcheck}
              type="button"
            >
              <span className="msettings-toggle-knob" />
            </button>
          </div>

          <div className="msettings-row">
            <div className="msettings-label">
              Typewriter Mode
              <span className="msettings-label-desc">
                Keep cursor centered
              </span>
            </div>
            <button
              className={`msettings-toggle${settings.typewriterMode ? " msettings-toggle--on" : ""}`}
              onClick={() =>
                updateSetting("typewriterMode", !settings.typewriterMode)
              }
              role="switch"
              aria-checked={settings.typewriterMode}
              type="button"
            >
              <span className="msettings-toggle-knob" />
            </button>
          </div>

          <div className="msettings-row">
            <div className="msettings-label">
              Focus Mode
              <span className="msettings-label-desc">
                Dim non-active paragraphs
              </span>
            </div>
            <button
              className={`msettings-toggle${settings.focusMode ? " msettings-toggle--on" : ""}`}
              onClick={() => updateSetting("focusMode", !settings.focusMode)}
              role="switch"
              aria-checked={settings.focusMode}
              type="button"
            >
              <span className="msettings-toggle-knob" />
            </button>
          </div>
        </section>

        {/* ─── About Section ─── */}
        <section className="msettings-section msettings-section--about">
          <h2 className="msettings-section-title">About</h2>

          <div className="msettings-row">
            <div className="msettings-label">Version</div>
            <span className="msettings-value">{appVersion}</span>
          </div>

          <div className="msettings-row">
            <div className="msettings-label">Made by</div>
            <span className="msettings-value">Paya Ebrahimi</span>
          </div>

          <div className="msettings-row">
            <button
              className="msettings-link-btn"
              onClick={() => platform.openExternal("https://pennivo.app")}
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" />
                <path d="M2 10h16" />
                <path d="M10 2c2.5 2.5 3.5 5 3.5 8s-1 5.5-3.5 8c-2.5-2.5-3.5-5-3.5-8s1-5.5 3.5-8z" />
              </svg>
              pennivo.app
            </button>
          </div>

          <div className="msettings-row">
            <button
              className="msettings-link-btn"
              onClick={() =>
                platform.openExternal("https://github.com/paya-e/pennivo")
              }
              type="button"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7.5 16.5c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 18.5 2.5a5.07 5.07 0 0 0-.09-3.72S17.22-1.68 14.5.5a13.38 13.38 0 0 0-7 0C4.78-1.68 3.59-1.22 3.59-1.22A5.07 5.07 0 0 0 3.5 2.5 5.44 5.44 0 0 0 2 6.02c0 5.42 3.3 6.61 6.44 7a3.37 3.37 0 0 0-.94 2.58v3.9" />
              </svg>
              GitHub
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
