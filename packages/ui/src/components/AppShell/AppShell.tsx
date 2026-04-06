import { type ReactNode, useState, useCallback, useRef, useEffect } from 'react';
import { Titlebar, type MenuAction, type RecentFileEntry } from '../Titlebar/Titlebar';
import { Statusbar, type SaveStatus } from '../Statusbar/Statusbar';
import './AppShell.css';

interface AppShellProps {
  filename?: string;
  isDirty?: boolean;
  wordCount?: number;
  charCount?: number;
  saveStatus?: SaveStatus;
  focusMode?: boolean;
  onMenuAction?: (action: MenuAction) => void;
  recentFiles?: RecentFileEntry[];
  onOpenRecentFile?: (filePath: string) => void;
  toolbar: ReactNode;
  findReplace?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  filename = 'untitled.md',
  isDirty = false,
  wordCount = 0,
  charCount = 0,
  saveStatus = 'saved',
  focusMode = false,
  onMenuAction,
  recentFiles,
  onOpenRecentFile,
  toolbar,
  findReplace,
  sidebar,
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
        // Don't auto-hide while a menu dropdown is open
        if (document.querySelector('.titlebar-menu-dropdown')) return;
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
      <Titlebar filename={filename} isDirty={isDirty} onMenuAction={onMenuAction} recentFiles={recentFiles} onOpenRecentFile={onOpenRecentFile} />
      <div className="app-toolbar-row">{toolbar}</div>
      {findReplace}
      <div className="app-body">
        {sidebar}
        <main className="app-editor-area">
          <div className="app-editor-column">{children}</div>
        </main>
      </div>
      <Statusbar wordCount={wordCount} charCount={charCount} saveStatus={saveStatus} />
    </div>
  );
}
