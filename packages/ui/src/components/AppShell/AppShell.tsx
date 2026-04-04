import { type ReactNode, useState, useCallback, useRef, useEffect } from 'react';
import { Titlebar, type MenuAction } from '../Titlebar/Titlebar';
import { Statusbar, type SaveStatus } from '../Statusbar/Statusbar';
import './AppShell.css';

interface AppShellProps {
  filename?: string;
  isDirty?: boolean;
  wordCount?: number;
  saveStatus?: SaveStatus;
  focusMode?: boolean;
  onMenuAction?: (action: MenuAction) => void;
  toolbar: ReactNode;
  children: ReactNode;
}

export function AppShell({
  filename = 'untitled.md',
  isDirty = false,
  wordCount = 0,
  saveStatus = 'saved',
  focusMode = false,
  onMenuAction,
  toolbar,
  children,
}: AppShellProps) {
  const [chromeVisible, setChromeVisible] = useState(true);
  const chromeVisibleRef = useRef(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setChromeState = useCallback((visible: boolean) => {
    chromeVisibleRef.current = visible;
    setChromeVisible(visible);
  }, []);

  // Auto-hide chrome in focus mode: show when mouse near top edge
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!focusMode) return;
      // titlebar (36px) + toolbar (38px) = 74px chrome height
      if (e.clientY <= 8) {
        clearTimeout(hideTimerRef.current);
        setChromeState(true);
      } else if (chromeVisibleRef.current && e.clientY <= 80) {
        // Keep visible while mouse is over the chrome area
        clearTimeout(hideTimerRef.current);
      } else if (e.clientY > 80) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = setTimeout(() => setChromeState(false), 500);
      }
    },
    [focusMode, setChromeState],
  );

  useEffect(() => {
    if (focusMode) {
      // Start hidden after a short delay
      hideTimerRef.current = setTimeout(() => setChromeState(false), 600);
      window.addEventListener('mousemove', handleMouseMove);
    } else {
      clearTimeout(hideTimerRef.current);
      setChromeState(true);
    }
    return () => {
      clearTimeout(hideTimerRef.current);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [focusMode, handleMouseMove, setChromeState]);

  const shellClass = [
    'app-shell',
    focusMode ? 'app-shell--focus' : '',
    focusMode && !chromeVisible ? 'app-shell--chrome-hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClass}>
      <Titlebar filename={filename} isDirty={isDirty} onMenuAction={onMenuAction} />
      <div className="app-toolbar-row">{toolbar}</div>
      <main className="app-editor-area">
        <div className="app-editor-column">{children}</div>
      </main>
      <Statusbar wordCount={wordCount} saveStatus={saveStatus} />
    </div>
  );
}
