import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from '../../hooks/useTheme';
import type { ThemeMode, ColorScheme } from '../../hooks/useTheme';
import './SettingsPanel.css';

export interface AppSettings {
  editorFontSize: number;
  editorFontFamily: string;
  autoSave: boolean;
  autoSaveDelay: number;
  spellcheck: boolean;
  showWordCount: boolean;
  typewriterMode: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  editorFontSize: 16,
  editorFontFamily: 'serif',
  autoSave: true,
  autoSaveDelay: 3,
  spellcheck: true,
  showWordCount: true,
  typewriterMode: false,
};

interface SettingsPanelProps {
  visible: boolean;
  onClose: () => void;
  typewriterMode: boolean;
  onTypewriterModeChange: (v: boolean) => void;
  onChange?: (settings: Record<string, unknown>) => void;
}

export function SettingsPanel({ visible, onClose, typewriterMode, onTypewriterModeChange, onChange }: SettingsPanelProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { mode, setMode, colorScheme, setColorScheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  // Load settings from disk on open
  useEffect(() => {
    if (!visible) return;
    window.pennivo?.getSettings?.().then((saved: Record<string, unknown>) => {
      if (saved && typeof saved === 'object') {
        setSettings(prev => ({ ...prev, ...saved }));
      }
      setLoaded(true);
    });
  }, [visible]);

  const persistSettings = useCallback((updated: AppSettings) => {
    setSettings(updated);
    window.pennivo?.setSettings?.(updated as unknown as Record<string, unknown>);
    onChange?.(updated as unknown as Record<string, unknown>);
  }, [onChange]);

  // Apply font size and family to CSS custom properties
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.style.setProperty('--text-base', `${settings.editorFontSize}px`);
  }, [settings.editorFontSize, loaded]);

  useEffect(() => {
    if (!loaded) return;
    const families: Record<string, string> = {
      serif: '"Georgia", "Times New Roman", serif',
      'sans-serif': '"Segoe UI", system-ui, sans-serif',
      monospace: '"Cascadia Code", "Fira Code", "Consolas", monospace',
    };
    document.documentElement.style.setProperty('--font-editor', families[settings.editorFontFamily] || families['serif']);
  }, [settings.editorFontFamily, loaded]);

  // Apply spellcheck setting
  useEffect(() => {
    if (!loaded) return;
    if (settings.spellcheck) {
      window.pennivo?.setSpellCheckLanguages?.(['en-US']);
    } else {
      window.pennivo?.setSpellCheckLanguages?.([]);
    }
  }, [settings.spellcheck, loaded]);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const updated = { ...settings, [key]: value };
    persistSettings(updated);
  };

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="settings-panel" role="dialog" aria-label="Settings">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
        <div className="settings-body">
          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>

            <div className="settings-row">
              <div className="settings-label">Theme</div>
              <select
                className="settings-select"
                value={mode}
                onChange={(e) => setMode(e.target.value as ThemeMode)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-label">Color Scheme</div>
              <select
                className="settings-select"
                value={colorScheme}
                onChange={(e) => setColorScheme(e.target.value as ColorScheme)}
              >
                <option value="default">Default</option>
                <option value="sepia">Sepia</option>
                <option value="nord">Nord</option>
                <option value="rosepine">Rose Pine</option>
              </select>
            </div>
          </div>

          {/* Editor */}
          <div className="settings-section">
            <div className="settings-section-title">Editor</div>

            <div className="settings-row">
              <div className="settings-label">
                Font Size
                <span className="settings-label-desc">Editor text size (12\u201324px)</span>
              </div>
              <div className="settings-slider-row">
                <input
                  type="range"
                  className="settings-slider"
                  min={12}
                  max={24}
                  step={1}
                  value={settings.editorFontSize}
                  onChange={(e) => updateSetting('editorFontSize', Number(e.target.value))}
                />
                <span className="settings-slider-value">{settings.editorFontSize}px</span>
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-label">Font Family</div>
              <select
                className="settings-select"
                value={settings.editorFontFamily}
                onChange={(e) => updateSetting('editorFontFamily', e.target.value)}
              >
                <option value="serif">Serif (Georgia)</option>
                <option value="sans-serif">Sans-serif (Segoe UI)</option>
                <option value="monospace">Monospace (Cascadia Code)</option>
              </select>
            </div>

            <div className="settings-row">
              <div className="settings-label">Typewriter Mode</div>
              <button
                className={`settings-toggle${typewriterMode ? ' settings-toggle--on' : ''}`}
                onClick={() => onTypewriterModeChange(!typewriterMode)}
                role="switch"
                aria-checked={typewriterMode}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          </div>

          {/* Saving */}
          <div className="settings-section">
            <div className="settings-section-title">Saving</div>

            <div className="settings-row">
              <div className="settings-label">
                Auto-save
                <span className="settings-label-desc">Automatically save open files</span>
              </div>
              <button
                className={`settings-toggle${settings.autoSave ? ' settings-toggle--on' : ''}`}
                onClick={() => updateSetting('autoSave', !settings.autoSave)}
                role="switch"
                aria-checked={settings.autoSave}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>

            {settings.autoSave && (
              <div className="settings-row">
                <div className="settings-label">
                  Auto-save Delay
                  <span className="settings-label-desc">Seconds after last edit</span>
                </div>
                <div className="settings-slider-row">
                  <input
                    type="range"
                    className="settings-slider"
                    min={1}
                    max={10}
                    step={1}
                    value={settings.autoSaveDelay}
                    onChange={(e) => updateSetting('autoSaveDelay', Number(e.target.value))}
                  />
                  <span className="settings-slider-value">{settings.autoSaveDelay}s</span>
                </div>
              </div>
            )}
          </div>

          {/* General */}
          <div className="settings-section">
            <div className="settings-section-title">General</div>

            <div className="settings-row">
              <div className="settings-label">Spell Check</div>
              <button
                className={`settings-toggle${settings.spellcheck ? ' settings-toggle--on' : ''}`}
                onClick={() => updateSetting('spellcheck', !settings.spellcheck)}
                role="switch"
                aria-checked={settings.spellcheck}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>

            <div className="settings-row">
              <div className="settings-label">Show Word Count</div>
              <button
                className={`settings-toggle${settings.showWordCount ? ' settings-toggle--on' : ''}`}
                onClick={() => updateSetting('showWordCount', !settings.showWordCount)}
                role="switch"
                aria-checked={settings.showWordCount}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
